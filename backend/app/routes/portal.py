"""Customer portal API. Every route requires role=customer and only ever
touches the signed-in customer's own records."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request, send_file

from ..db import get_db, transaction
from ..errors import DemoAccountError, NotFoundError, ValidationError
from ..repo import customers as cust_repo
from ..repo import enrolments as enrol_repo
from ..repo import messages as msg_repo
from ..repo import programmes as prog_repo
from ..repo import submissions as sub_repo
from ..repo import users as users_repo
from ..security import customer_required
from ..nlp import pipeline as nlp
from ..services import checklist, documents
from ..validation import Validator, clean_id, clean_phone, clean_str, clean_text_block
from ._common import audit_event, body, cfg

bp = Blueprint("portal", __name__, url_prefix="/api/portal")

# Fields a customer may see about their own submissions (no internal NLP scores or staff ids).
SUBMISSION_FIELDS = ("id", "required_document_id", "doc_code", "document_name", "original_filename", "file_size",
                     "mime_type", "customer_note", "status", "rejection_reason", "created_at", "verified_at",
                     "detected_doc_code", "customer_confirmed")
CHECKLIST_HIDDEN = ("match_confidence",)
# Harmless writes a demo login may still make (clearing its own unread badge).
DEMO_ALLOWED = {"portal.messages_read"}


@bp.before_request
@customer_required
def _guard():
    """All portal endpoints require a customer session; demo logins are read-only."""
    if g.user.get("is_demo") and request.method not in ("GET", "HEAD", "OPTIONS") \
            and request.endpoint not in DEMO_ALLOWED:
        raise DemoAccountError(
            "This is a shared demo account, so it can't upload documents, send messages or enrol. "
            "Create your own account to do that.", {"demo": True})


def _cid() -> int:
    return g.user["customer_id"]


def _public_checklist(cl: dict) -> dict:
    items = [{k: v for k, v in i.items() if k not in CHECKLIST_HIDDEN} for i in cl["items"]]
    return {**cl, "items": items}


def _enrolment_payload(conn, enrolment: dict) -> dict:
    cl = checklist.checklist_for(conn, enrolment)
    return {
        "enrolment": {k: enrolment[k] for k in ("id", "enrolment_ref", "status", "completion_pct", "programme_id",
                                                "programme_name", "programme_code", "programme_category",
                                                "due_date", "target_start_date", "created_at", "completed_at",
                                                "cancelled_at", "cancellation_reason")},
        "checklist": _public_checklist(cl),
        "submissions": [{**{k: s.get(k) for k in SUBMISSION_FIELDS}, "has_file": bool(s.get("stored_path")),
                         # only a real file an officer uploaded counts as "added by your team";
                         # a note the officer logged from the customer's own message does not
                         "added_by_staff": s.get("uploaded_by_role") == "admin" and s.get("channel") == "upload",
                         "from_message": s.get("channel") == "pasted_text"}
                        for s in sub_repo.for_enrolment(conn, enrolment["id"]) if s["status"] != "superseded"],
    }


@bp.get("/overview")
def overview():
    conn = get_db()
    customer = cust_repo.get(conn, _cid())
    enrolments = enrol_repo.list_enrolments(conn, customer_id=_cid())
    cards = []
    for e in enrolments:
        payload = _enrolment_payload(conn, e)
        cards.append({**payload["enrolment"], "next_step": payload["checklist"]["next_step"],
                      "required_count": payload["checklist"]["required_count"],
                      "collected_count": payload["checklist"]["collected_count"],
                      "verified_count": payload["checklist"]["verified_count"]})
    messages = msg_repo.for_customer(conn, _cid())
    return jsonify({
        "customer": {k: customer[k] for k in ("id", "customer_ref", "full_name", "email", "phone", "country")},
        "enrolments": cards,
        "unread_messages": sum(1 for m in messages if m["direction"] == "to_customer" and not m["is_read"]),
        "latest_messages": [m for m in messages if m["direction"] == "to_customer"][:3],
    })


@bp.get("/enrolments/<int:enrolment_id>")
def enrolment(enrolment_id: int):
    conn = get_db()
    return jsonify(_enrolment_payload(conn, enrol_repo.get_for_customer(conn, enrolment_id, _cid())))


@bp.post("/enrolments")
def self_enrol():
    """Customer adds another programme from the catalogue."""
    v = Validator(body())
    programme_id = v.field("programme_id", clean_id)
    note = v.field("note", clean_text_block, required=False, label="Note")
    v.raise_if_errors()
    conn = get_db()
    programme = prog_repo.get(conn, programme_id)
    if not programme["is_active"]:
        raise ValidationError("That programme is not open for enrolment.", {"programme_id": "Not available."})
    with transaction(conn):
        eid = enrol_repo.create(conn, customer_id=_cid(), programme_id=programme_id, source="self_service",
                                created_by=g.user["id"], intake_text=note,
                                due_date=enrol_repo.default_due_date(cfg().default_due_days))
        checklist.run_check(conn, eid, actor=g.user, reason="enrolment_created")
        audit_event(conn, "enrolment.created", "enrolment", eid, eid, {"programme": programme["code"],
                                                                     "source": "self_service"})
        msg_repo.notify(conn, users_repo.admin_ids(conn), kind="enrolment", title="New self-service enrolment",
                        body=f"{g.user['full_name']} enrolled on {programme['name']}.", link=f"/admin/enrolments/{eid}")
    return jsonify(_enrolment_payload(conn, enrol_repo.get(conn, eid))), 201


# ------------------------------------------------------------------ messages
@bp.get("/messages")
def messages():
    return jsonify({"items": msg_repo.for_customer(get_db(), _cid())})


@bp.post("/messages/read")
def messages_read():
    v = Validator(body())
    message_id = v.field("message_id", clean_id) if "message_id" in v.data else None
    v.raise_if_errors()
    conn = get_db()
    with transaction(conn):
        n = msg_repo.mark_read_for_customer(conn, _cid(), message_id)
    return jsonify({"marked": n})


@bp.post("/enrolments/<int:enrolment_id>/messages")
def reply(enrolment_id: int):
    v = Validator(body())
    subject = v.field("subject", clean_str, required=False, max_len=150, label="Subject")
    text = v.field("body", clean_text_block, min_len=2, max_len=4000, label="Message")
    v.raise_if_errors()
    conn = get_db()
    enrolment = enrol_repo.get_for_customer(conn, enrolment_id, _cid())
    programme = prog_repo.get(conn, enrolment["programme_id"])
    analysis = nlp.analyze_text(text, programme, prog_repo.list_programmes(conn))
    with transaction(conn):
        extraction_id = documents.record_extraction(conn, enrolment_id=enrolment_id, submission_id=None,
                                                    source_type="customer_reply", original=text, analysis=analysis)
        mid = msg_repo.create_message(conn, {"enrolment_id": enrolment_id, "direction": "from_customer",
                                             "subject": subject or f"Message about {enrolment['programme_name']}",
                                             "body": text, "author_user_id": g.user["id"],
                                             "nlp_extraction_id": extraction_id})
        audit_event(conn, "message.received", "message", mid, enrolment_id,
                    {"length": len(text), "intent": analysis["intent"]["label"]})
        msg_repo.notify(conn, users_repo.admin_ids(conn), kind="customer_message",
                        title=f"New message from {g.user['full_name']}", body=text[:140],
                        link=f"/admin/enrolments/{enrolment_id}")
    return jsonify({"items": msg_repo.for_customer(conn, _cid())}), 201


# ------------------------------------------------------------------ profile
@bp.patch("/profile")
def profile():
    v = Validator(body())
    values = {}
    if "phone" in v.data:
        values["phone"] = v.field("phone", clean_phone)
    if "country" in v.data:
        values["country"] = v.field("country", clean_str, required=False, max_len=60)
    v.raise_if_errors()
    if not values:
        raise ValidationError("Nothing to update.", {"body": "Send phone and/or country."})
    conn = get_db()
    with transaction(conn):
        cust_repo.update_customer(conn, _cid(), values)
        audit_event(conn, "customer.profile_updated", "customer", _cid(), details=values)
    return jsonify({"customer": cust_repo.get(conn, _cid())})


# ------------------------------------------------------------------ documents
@bp.post("/enrolments/<int:enrolment_id>/uploads")
def upload(enrolment_id: int):
    conn = get_db()
    enrolment = enrol_repo.get_for_customer(conn, enrolment_id, _cid())
    doc_id = request.form.get("required_document_id")
    note = clean_text_block(request.form.get("note"), "note", required=False, min_len=1, max_len=500, label="Note")
    with transaction(conn):
        result = documents.save_upload(conn, cfg(), enrolment=enrolment, file=request.files.get("file"), note=note,
                                       chosen_doc_id=clean_id(doc_id, "required_document_id") if doc_id else None,
                                       actor=g.user)
        msg_repo.notify(conn, users_repo.admin_ids(conn), kind="upload",
                        title=f"{g.user['full_name']} uploaded a document",
                        body=result["submission"]["original_filename"] or "", link=f"/admin/enrolments/{enrolment_id}")
    best = result["suggestion"]["best"]
    return jsonify({
        "submission": {**{k: result["submission"].get(k) for k in SUBMISSION_FIELDS},
                       "has_file": bool(result["submission"].get("stored_path"))},
        "suggestion": {"doc_code": best["doc_code"], "name": best["name"],
                       "required_document_id": best["required_document_id"], "confidence": best["confidence"]}
        if best else None,
        "alternatives": [{"doc_code": s["doc_code"], "name": s["name"], "required_document_id": s["required_document_id"]}
                         for s in result["suggestion"]["suggestions"]],
        "needs_confirmation": result["needs_confirmation"],
        "warning": result["warning"],
        **_enrolment_payload(conn, enrol_repo.get(conn, enrolment_id)),
    }), 201


@bp.post("/submissions/<int:submission_id>/confirm")
def confirm(submission_id: int):
    v = Validator(body())
    doc_id = v.field("required_document_id", clean_id)
    v.raise_if_errors()
    conn = get_db()
    sub = sub_repo.get(conn, submission_id)
    enrolment = enrol_repo.get_for_customer(conn, sub["enrolment_id"], _cid())
    with transaction(conn):
        documents.confirm_document_type(conn, enrolment=enrolment, submission=sub, doc_id=doc_id, actor=g.user)
    return jsonify(_enrolment_payload(conn, enrol_repo.get(conn, enrolment["id"])))


@bp.get("/submissions/<int:submission_id>/file")
def submission_file(submission_id: int):
    conn = get_db()
    sub = sub_repo.get(conn, submission_id)
    enrol_repo.get_for_customer(conn, sub["enrolment_id"], _cid())
    path = documents.file_path(cfg(), sub)
    if not path:
        raise NotFoundError("This file is not available.")
    return send_file(path, mimetype=sub["mime_type"], download_name=sub["original_filename"], as_attachment=False)
