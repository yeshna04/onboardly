"""Checklist comparison: required documents vs. what has been submitted.

This is the deterministic heart of the app. The NLP layer decides *which*
required document a submission is; this module decides what the checklist
looks like as a result and which enrolment status follows from it.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

from ..db import insert, to_json
from ..repo import audit
from ..repo import enrolments as enrol_repo
from ..repo import programmes as prog_repo
from ..repo import submissions as sub_repo

# Higher wins when several submissions exist for the same document.
STATE_PRIORITY = {"verified": 6, "submitted": 5, "needs_review": 4, "pending": 3, "rejected": 2}
COLLECTED_STATES = {"verified", "submitted", "needs_review"}
OUTSTANDING_STATES = {"missing", "pending", "rejected", "expired"}

STATE_LABELS = {
    "verified": "Verified",
    "submitted": "Submitted – awaiting verification",
    "needs_review": "Needs staff review",
    "pending": "Customer said it will follow",
    "rejected": "Rejected – please re-upload",
    "expired": "Expired – please upload a newer copy",
    "missing": "Missing",
}


def _as_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def build_checklist(required_docs: list[dict], submissions: list[dict], today: date | None = None) -> dict:
    """Pure function – no DB access – so it is easy to unit-test."""
    today = today or datetime.now(timezone.utc).date()
    items = []
    for doc in required_docs:
        candidates = [s for s in submissions
                      if s.get("required_document_id") == doc["id"] and s.get("status") != "superseded"]
        candidates.sort(key=lambda s: (STATE_PRIORITY.get(s["status"], 0), s.get("created_at") or "", s["id"]),
                        reverse=True)
        best = candidates[0] if candidates else None
        state = best["status"] if best else "missing"
        items.append({
            "required_document_id": doc["id"],
            "doc_code": doc["doc_code"],
            "name": doc["name"],
            "description": doc.get("description", ""),
            "why_needed": doc.get("why_needed", ""),
            "accepted_formats": doc.get("accepted_formats", ""),
            "is_mandatory": bool(doc["is_mandatory"]),
            "state": state,
            "state_label": STATE_LABELS[state],
            "submission_id": best["id"] if best else None,
            "filename": best.get("original_filename") if best else None,
            "match_confidence": best.get("match_confidence") if best else None,
            "rejection_reason": best.get("rejection_reason") if best else None,
            "submitted_at": best.get("created_at") if best else None,
            "verified_at": best.get("verified_at") if best else None,
            "attempts": len(candidates),
        })

    mandatory = [i for i in items if i["is_mandatory"]]
    collected = [i for i in mandatory if i["state"] in COLLECTED_STATES]
    verified = [i for i in mandatory if i["state"] == "verified"]
    outstanding = [i for i in mandatory if i["state"] in OUTSTANDING_STATES]
    needs_review = [i for i in items if i["state"] == "needs_review"]
    total = len(mandatory)
    return {
        "items": items,
        "required_count": total,
        "collected_count": len(collected),
        "verified_count": len(verified),
        "completion_pct": round(100.0 * len(collected) / total, 1) if total else 100.0,
        "verified_pct": round(100.0 * len(verified) / total, 1) if total else 100.0,
        "outstanding": [{"doc_code": i["doc_code"], "name": i["name"], "state": i["state"],
                         "rejection_reason": i["rejection_reason"]} for i in outstanding],
        "needs_review": [{"doc_code": i["doc_code"], "name": i["name"]} for i in needs_review],
        "optional_outstanding": [{"doc_code": i["doc_code"], "name": i["name"]}
                                 for i in items if not i["is_mandatory"] and i["state"] in OUTSTANDING_STATES],
        "all_collected": total > 0 and not outstanding,
        "all_verified": total > 0 and len(verified) == total,
    }


def derive_status(current: str, checklist: dict, has_submissions: bool) -> str:
    if current in ("completed", "cancelled"):
        return current
    if checklist["all_collected"]:
        return "ready_for_review"
    if has_submissions:
        return "awaiting_docs"
    return "new"


PROPER_WORDS = {"English", "IELTS", "TOEFL", "CV", "ID"}


def _lower_first(name: str) -> str:
    """'Signed learner agreement' → 'signed learner agreement', but keep 'English …' / 'CV …'."""
    first = name.split(" ", 1)[0]
    return name if first in PROPER_WORDS or first.isupper() else name[:1].lower() + name[1:]


def next_step(checklist: dict) -> dict:
    """Plain-language guidance for the customer portal (no AI involved)."""
    order = {"rejected": 0, "expired": 1, "missing": 2, "pending": 3}
    outstanding = sorted(checklist["outstanding"], key=lambda i: order.get(i["state"], 9))
    if outstanding:
        first = outstanding[0]
        verb = {"rejected": "Re-upload", "expired": "Upload a newer copy of"}.get(first["state"], "Upload")
        detail = first.get("rejection_reason") or ""
        return {"kind": "upload", "doc_code": first["doc_code"],
                "title": f"{verb} your {_lower_first(first['name'])}",
                "detail": detail or f"{len(outstanding)} required document(s) still to go.",
                "remaining": len(outstanding)}
    if not checklist["all_verified"]:
        return {"kind": "wait", "title": "We're checking your documents",
                "detail": "Everything required is in. Our team will verify it shortly.", "remaining": 0}
    return {"kind": "done", "title": "All documents verified",
            "detail": "Your onboarding team will confirm your start shortly.", "remaining": 0}


def checklist_for(conn: sqlite3.Connection, enrolment: dict) -> dict:
    docs = prog_repo.required_documents(conn, enrolment["programme_id"])
    subs = sub_repo.for_enrolment(conn, enrolment["id"])
    result = build_checklist(docs, subs)
    result["next_step"] = next_step(result)
    if enrolment.get("status") == "cancelled":
        result["next_step"] = {"kind": "cancelled", "title": "This enrolment was cancelled",
                               "detail": enrolment.get("cancellation_reason")
                               or "Your onboarding team cancelled this enrolment.", "remaining": 0}
    return result


def run_check(conn: sqlite3.Connection, enrolment_id: int, *, actor: dict | None,
              reason: str = "manual") -> dict:
    """Compare checklist, update enrolment status/completion, store a snapshot row.

    Caller owns the transaction (commit/rollback).
    """
    enrolment = enrol_repo.get(conn, enrolment_id)
    checklist = checklist_for(conn, enrolment)
    has_subs = any(i["attempts"] for i in checklist["items"])
    before = enrolment["status"]
    after = derive_status(before, checklist, has_subs)
    enrol_repo.set_fields(conn, enrolment_id, {"status": after, "completion_pct": checklist["completion_pct"]})
    check_id = insert(conn, "onboarding_checks", {
        "enrolment_id": enrolment_id,
        "required_count": checklist["required_count"],
        "collected_count": checklist["collected_count"],
        "verified_count": checklist["verified_count"],
        "completion_pct": checklist["completion_pct"],
        "checklist_json": to_json(checklist["items"]),
        "missing_json": to_json(checklist["outstanding"]),
        "status_before": before,
        "status_after": after,
        "triggered_by": actor["id"] if actor else None,
        "trigger_reason": reason,
    })
    if before != after:
        audit.record(conn, action="enrolment.status_changed", entity_type="enrolment", entity_id=enrolment_id,
                     enrolment_id=enrolment_id, actor=actor,
                     details={"before": before, "after": after, "reason": reason, "check_id": check_id})
    checklist["check_id"] = check_id
    checklist["status_before"] = before
    checklist["status"] = after
    return checklist
