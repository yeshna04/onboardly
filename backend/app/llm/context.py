"""Build the grounded, PII-minimised context the LLM is allowed to see."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from ..db import from_json, query_all
from ..nlp.preprocess import mask_pii
from ..services.checklist import COLLECTED_STATES, OUTSTANDING_STATES


def build_context(conn: sqlite3.Connection, enrolment: dict, checklist: dict) -> dict:
    items = []
    for i in checklist["items"]:
        items.append({
            "doc_code": i["doc_code"], "name": i["name"], "mandatory": i["is_mandatory"], "state": i["state"],
            "description": i["description"], "accepted_formats": i["accepted_formats"],
            "rejection_reason": i["rejection_reason"],
        })
    actionable = [i["doc_code"] for i in checklist["items"] if i["state"] in OUTSTANDING_STATES]
    with_staff = [i["doc_code"] for i in checklist["items"] if i["state"] in COLLECTED_STATES - {"verified"}]
    context = {
        "customer_first_name": (enrolment["customer_name"] or "there").split()[0],
        "programme": enrolment["programme_name"],
        "enrolment_ref": enrolment["enrolment_ref"],
        "today": datetime.now(timezone.utc).date().isoformat(),
        "due_date": enrolment.get("due_date"),
        "target_start_date": enrolment.get("target_start_date"),
        "completion_pct": checklist["completion_pct"],
        "mandatory_total": checklist["required_count"],
        "mandatory_verified": checklist["verified_count"],
        "items": items,
        "customer_actionable": actionable,
        "with_staff": with_staff,
    }
    return context


def customer_evidence(conn: sqlite3.Connection, enrolment_id: int, limit: int = 6) -> list[dict]:
    """Quotes from the customer (via NLP) about items that are pending – already PII-masked."""
    rows = query_all(conn, """SELECT document_matches_json, created_at FROM nlp_extractions
                              WHERE enrolment_id = ? AND source_type IN ('intake_text','customer_reply')
                              ORDER BY id DESC LIMIT 10""", [enrolment_id])
    seen, out = set(), []
    for r in rows:
        for m in from_json(r["document_matches_json"], []):
            if m.get("cue") == "pending" and m.get("doc_code") not in seen:
                seen.add(m["doc_code"])
                out.append({"doc_code": m["doc_code"], "customer_said": mask_pii(m.get("sentence", ""))[:240],
                            "date": r["created_at"][:10]})
    return out[:limit]


def recent_messages(conn: sqlite3.Connection, enrolment_id: int, limit: int = 3) -> list[dict]:
    rows = query_all(conn, """SELECT m.body, m.created_at, x.intent FROM messages m
                              LEFT JOIN nlp_extractions x ON x.id = m.nlp_extraction_id
                              WHERE m.enrolment_id = ? AND m.direction = 'from_customer'
                              ORDER BY m.id DESC LIMIT ?""", [enrolment_id, limit])
    return [{"intent": r["intent"], "excerpt": mask_pii(r["body"])[:300], "date": r["created_at"][:10]} for r in rows]
