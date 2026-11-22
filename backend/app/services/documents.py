"""Document intake: file uploads and pasted intake text, both routed through the NLP pipeline."""
from __future__ import annotations

import mimetypes
import sqlite3
import uuid
from pathlib import Path

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from ..config import Config
from ..db import insert, to_json
from ..errors import ConflictError, ValidationError
from ..nlp import pipeline as nlp
from ..nlp.preprocess import mask_pii
from ..repo import audit
from ..repo import programmes as prog_repo
from ..repo import submissions as sub_repo
from . import checklist

TEXT_EXT = {"txt", "csv", "json"}
MAGIC = {"pdf": (b"%PDF",), "png": (b"\x89PNG\r\n\x1a\n",), "jpg": (b"\xff\xd8\xff",), "jpeg": (b"\xff\xd8\xff",)}
FINAL_ENROLMENT_STATES = ("completed", "cancelled")


def ensure_open(enrolment: dict) -> None:
    if enrolment["status"] in FINAL_ENROLMENT_STATES:
        raise ConflictError(f"This enrolment is {enrolment['status']}; documents can no longer be added.")


def record_extraction(conn: sqlite3.Connection, *, enrolment_id: int | None, submission_id: int | None,
                      source_type: str, original: str, analysis: dict) -> int:
    return insert(conn, "nlp_extractions", {
        "enrolment_id": enrolment_id,
        "submission_id": submission_id,
        "source_type": source_type,
        "input_excerpt": mask_pii(original or "")[:2000],
        "clean_text": analysis.get("masked_text") or analysis.get("input") or "",
        "tokens_json": to_json(analysis.get("tokens", [])),
        "entities_json": to_json(analysis.get("entities", {})),
        "detected_service_json": to_json(analysis.get("detected_service", {})),
        "document_matches_json": to_json(analysis.get("document_matches") or analysis.get("suggestions") or []),
        "intent": (analysis.get("intent") or {}).get("label"),
        "pipeline_version": analysis.get("pipeline_version", "unknown"),
    })


# ------------------------------------------------------------------ uploads
def _read_and_check(file: FileStorage, cfg: Config) -> tuple[bytes, str, str]:
    if not file or not file.filename:
        raise ValidationError("Choose a file to upload.", {"file": "No file selected."})
    original = file.filename.strip()[:200]
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in cfg.allowed_upload_ext:
        raise ValidationError("This file type isn't supported.",
                              {"file": f"Allowed: {', '.join(sorted(set(cfg.allowed_upload_ext)))}."})
    data = file.read(cfg.max_upload_mb * 1024 * 1024 + 1)
    if not data:
        raise ValidationError("The file is empty.", {"file": "The uploaded file has no content."})
    if len(data) > cfg.max_upload_mb * 1024 * 1024:
        raise ValidationError("The file is too large.", {"file": f"Maximum size is {cfg.max_upload_mb} MB."})
    if ext in MAGIC and not data.startswith(MAGIC[ext]):
        raise ValidationError("The file content doesn't match its extension.",
                              {"file": f"This doesn't look like a real .{ext} file."})
    if ext in TEXT_EXT and b"\x00" in data[:4096]:
        raise ValidationError("The file content doesn't match its extension.", {"file": "Binary data in a text file."})
    return data, original, ext


def save_upload(conn: sqlite3.Connection, cfg: Config, *, enrolment: dict, file: FileStorage, note: str | None,
                chosen_doc_id: int | None, actor: dict) -> dict:
    ensure_open(enrolment)
    data, original, ext = _read_and_check(file, cfg)
    programme = prog_repo.get(conn, enrolment["programme_id"])
    docs = {d["id"]: d for d in programme["documents"]}
    if chosen_doc_id is not None and chosen_doc_id not in docs:
        raise ValidationError("That document isn't on this checklist.", {"required_document_id": "Wrong programme."})

    content_text = data[:200_000].decode("utf-8", errors="replace") if ext in TEXT_EXT else None
    suggestion = nlp.classify_upload(original, note, content_text, programme["documents"],
                                     review_threshold=cfg.nlp_review_threshold)
    best = suggestion["best"]

    warning = None
    if chosen_doc_id is not None:
        doc = docs[chosen_doc_id]
        status = "submitted"
        if best and best["confidence"] == "high" and best["doc_code"] != doc["doc_code"]:
            status = "needs_review"
            warning = (f"This file looks more like your {best['name']} than your {doc['name']}. "
                       "Our team will double-check it.")
        confirmed = 1
    elif best:
        doc = docs[best["required_document_id"]]
        status = "submitted" if best["confidence"] == "high" else "needs_review"
        confirmed = 0
    else:
        doc, status, confirmed = None, "needs_review", 0

    folder = cfg.upload_dir / str(enrolment["id"])
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    (folder / stored_name).write_bytes(data)
    entities = suggestion.get("entities", {})
    doc_date = next((d["iso"] for d in entities.get("dates", []) if d.get("kind") == "absolute"), None)

    sid = sub_repo.create(conn, {
        "enrolment_id": enrolment["id"],
        "required_document_id": doc["id"] if doc else None,
        "channel": "upload",
        "original_filename": secure_filename(original) or f"upload.{ext}",
        "stored_path": f"{enrolment['id']}/{stored_name}",
        "mime_type": mimetypes.types_map.get(f".{ext}", "application/octet-stream"),
        "file_size": len(data),
        "customer_note": note,
        "extracted_text": mask_pii(content_text[:5000]) if content_text else None,
        "detected_doc_code": best["doc_code"] if best else None,
        "match_confidence": best["score"] if best else 0.0,
        "customer_confirmed": confirmed,
        "status": status,
        "document_date": doc_date,
        "uploaded_by": actor["id"],
    })
    if doc:
        sub_repo.supersede_older(conn, enrolment["id"], doc["id"], sid)
    record_extraction(conn, enrolment_id=enrolment["id"], submission_id=sid, source_type="submission",
                      original=f"{original} {note or ''}", analysis=suggestion)
    audit.record(conn, action="submission.uploaded", entity_type="document_submission", entity_id=sid,
                 enrolment_id=enrolment["id"], actor=actor,
                 details={"filename": original, "size": len(data), "chosen": doc["doc_code"] if chosen_doc_id else None,
                          "nlp_suggestion": best and {k: best[k] for k in ("doc_code", "score", "confidence")},
                          "status": status})
    cl = checklist.run_check(conn, enrolment["id"], actor=actor, reason="document_uploaded")
    return {
        "submission": sub_repo.get(conn, sid),
        "suggestion": suggestion,
        "needs_confirmation": doc is None or (chosen_doc_id is None and status == "needs_review"),
        "warning": warning,
        "checklist": cl,
    }


def confirm_document_type(conn: sqlite3.Connection, *, enrolment: dict, submission: dict, doc_id: int,
                          actor: dict) -> dict:
    ensure_open(enrolment)
    doc = prog_repo.get_document(conn, doc_id)
    if doc["programme_id"] != enrolment["programme_id"]:
        raise ValidationError("That document isn't on this checklist.", {"required_document_id": "Wrong programme."})
    if submission["status"] in ("verified", "rejected", "superseded"):
        raise ConflictError("This file has already been reviewed by our team.")
    sub_repo.set_fields(conn, submission["id"], {"required_document_id": doc_id, "customer_confirmed": 1,
                                                 "status": "submitted"})
    sub_repo.supersede_older(conn, enrolment["id"], doc_id, submission["id"])
    audit.record(conn, action="submission.type_confirmed", entity_type="document_submission",
                 entity_id=submission["id"], enrolment_id=enrolment["id"], actor=actor,
                 details={"before": submission["doc_code"], "after": doc["doc_code"],
                          "nlp_suggestion": submission["detected_doc_code"]})
    return checklist.run_check(conn, enrolment["id"], actor=actor, reason="document_confirmed")


# ------------------------------------------------------------------ pasted intake text
def apply_intake_text(conn: sqlite3.Connection, cfg: Config, *, enrolment: dict, text: str, actor: dict) -> dict:
    """Read an email/note, record NLP output, and create submission rows for documents it says are attached."""
    ensure_open(enrolment)
    programme = prog_repo.get(conn, enrolment["programme_id"])
    all_programmes = prog_repo.list_programmes(conn)
    analysis = nlp.analyze_text(text, programme, all_programmes, match_threshold=cfg.nlp_match_threshold,
                                review_threshold=cfg.nlp_review_threshold)
    if analysis["intent"]["label"] == "unsupported" and not analysis["document_matches"]:
        extraction_id = record_extraction(conn, enrolment_id=enrolment["id"], submission_id=None,
                                          source_type="intake_text", original=text, analysis=analysis)
        audit.record(conn, action="nlp.unsupported_request", entity_type="enrolment", entity_id=enrolment["id"],
                     enrolment_id=enrolment["id"], actor=actor, details={"extraction_id": extraction_id})
        return {"analysis": analysis, "extraction_id": extraction_id, "created": [], "skipped": [],
                "checklist": checklist.checklist_for(conn, enrolment), "unsupported": True}

    current = {i["doc_code"]: i for i in checklist.checklist_for(conn, enrolment)["items"]}
    created, skipped = [], []
    extraction_id = record_extraction(conn, enrolment_id=enrolment["id"], submission_id=None,
                                      source_type="intake_text", original=text, analysis=analysis)
    for m in analysis["document_matches"]:
        state = current.get(m["doc_code"], {}).get("state")
        if m["cue"] == "mentioned":
            skipped.append({**m, "reason": "Only mentioned – no sign it was sent or promised."})
            continue
        if state in ("verified", "submitted", "needs_review"):
            skipped.append({**m, "reason": f"Already {state.replace('_', ' ')} on the checklist."})
            continue
        if m["cue"] == "pending":
            if state == "pending":
                skipped.append({**m, "reason": "Already marked as pending."})
                continue
            status = "pending"
        else:
            status = "submitted" if m["confidence"] == "high" else "needs_review"
        sid = sub_repo.create(conn, {
            "enrolment_id": enrolment["id"], "required_document_id": m["required_document_id"],
            "channel": "pasted_text", "customer_note": m["sentence"], "extracted_text": m["evidence"],
            "detected_doc_code": m["doc_code"], "match_confidence": m["score"], "customer_confirmed": 0,
            "status": status, "uploaded_by": actor["id"],
        })
        created.append({**m, "submission_id": sid, "status": status})

    conn.execute("UPDATE enrolments SET detected_service_code = ?, intake_text = COALESCE(intake_text, ?) "
                 "WHERE id = ?", [analysis["detected_service"]["code"], text[:5000], enrolment["id"]])
    audit.record(conn, action="nlp.intake_analysed", entity_type="enrolment", entity_id=enrolment["id"],
                 enrolment_id=enrolment["id"], actor=actor,
                 details={"extraction_id": extraction_id, "created": [(c["doc_code"], c["status"]) for c in created],
                          "detected_service": analysis["detected_service"]["code"],
                          "intent": analysis["intent"]["label"]})
    cl = checklist.run_check(conn, enrolment["id"], actor=actor, reason="intake_text")
    return {"analysis": analysis, "extraction_id": extraction_id, "created": created, "skipped": skipped,
            "checklist": cl, "unsupported": analysis["intent"]["label"] == "unsupported"}


def file_path(cfg: Config, submission: dict) -> Path | None:
    if not submission.get("stored_path"):
        return None
    path = (cfg.upload_dir / submission["stored_path"]).resolve()
    if cfg.upload_dir.resolve() not in path.parents or not path.is_file():
        return None
    return path
