"""Enrolments, invites and the list/detail queries the dashboards need."""
from __future__ import annotations

import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from ..db import insert, query_all, query_one, scalar, update
from ..errors import ConflictError, NotFoundError

STATUSES = ("new", "awaiting_docs", "ready_for_review", "completed", "cancelled")

_BASE_SELECT = """
    SELECT e.*,
           c.full_name AS customer_name, c.email AS customer_email, c.customer_ref, c.country,
           p.name AS programme_name, p.code AS programme_code, p.category AS programme_category
    FROM enrolments e
    JOIN customers c ON c.id = e.customer_id
    JOIN programmes p ON p.id = e.programme_id
"""


def next_ref(conn: sqlite3.Connection) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"ENR-{year}-"
    last = scalar(conn, "SELECT enrolment_ref FROM enrolments WHERE enrolment_ref LIKE ? "
                        "ORDER BY enrolment_ref DESC LIMIT 1", [f"{prefix}%"])
    number = int(last[len(prefix):]) + 1 if last else 1
    return f"{prefix}{number:04d}"


def get(conn: sqlite3.Connection, enrolment_id: int) -> dict:
    row = query_one(conn, _BASE_SELECT + " WHERE e.id = ?", [enrolment_id])
    if not row:
        raise NotFoundError(f"Enrolment {enrolment_id} was not found.")
    return row


def get_for_customer(conn: sqlite3.Connection, enrolment_id: int, customer_id: int) -> dict:
    """Customer-portal access: 404 (not 403) for other customers' records, to avoid leaking IDs."""
    row = query_one(conn, _BASE_SELECT + " WHERE e.id = ? AND e.customer_id = ?", [enrolment_id, customer_id])
    if not row:
        raise NotFoundError("We couldn't find that enrolment on your account.")
    return row


def list_enrolments(conn: sqlite3.Connection, *, status: str | None = None, programme_id: int | None = None,
                    customer_id: int | None = None, search: str | None = None, limit: int = 200) -> list[dict]:
    where, params = [], []
    if status:
        where.append("e.status = ?"); params.append(status)
    if programme_id:
        where.append("e.programme_id = ?"); params.append(programme_id)
    if customer_id:
        where.append("e.customer_id = ?"); params.append(customer_id)
    if search:
        where.append("(c.full_name LIKE ? OR c.email LIKE ? OR e.enrolment_ref LIKE ? OR p.name LIKE ?)")
        params += [f"%{search}%"] * 4
    clause = f" WHERE {' AND '.join(where)}" if where else ""
    rows = query_all(conn, _BASE_SELECT + clause + " ORDER BY e.updated_at DESC LIMIT ?", [*params, limit])
    if rows:
        ids = [r["id"] for r in rows]
        marks = ",".join("?" * len(ids))
        counts = {r["enrolment_id"]: r for r in query_all(conn, f"""
            SELECT enrolment_id,
                   SUM(status IN ('submitted','needs_review')) AS awaiting_verification,
                   SUM(status = 'needs_review') AS needs_review
            FROM document_submissions WHERE enrolment_id IN ({marks}) GROUP BY enrolment_id""", ids)}
        drafts = {r["enrolment_id"]: r["n"] for r in query_all(conn, f"""
            SELECT enrolment_id, COUNT(*) AS n FROM reminder_drafts
            WHERE status = 'draft' AND enrolment_id IN ({marks}) GROUP BY enrolment_id""", ids)}
        for r in rows:
            c = counts.get(r["id"], {})
            r["awaiting_verification"] = c.get("awaiting_verification") or 0
            r["needs_review"] = c.get("needs_review") or 0
            r["pending_drafts"] = drafts.get(r["id"], 0)
    return rows


def default_due_date(days: int) -> str:
    """Deadline for documents when nobody picked one (self-service enrolments)."""
    return (datetime.now(timezone.utc) + timedelta(days=days)).date().isoformat()


def create(conn: sqlite3.Connection, *, customer_id: int, programme_id: int, source: str,
           created_by: int | None, intake_text: str | None = None, target_start_date: str | None = None,
           due_date: str | None = None, enrolment_ref: str | None = None) -> int:
    existing = query_one(conn, "SELECT id, status FROM enrolments WHERE customer_id = ? AND programme_id = ?",
                         [customer_id, programme_id])
    if existing:
        raise ConflictError("This customer is already enrolled on that programme.",
                            {"programme_id": "Already enrolled.", "enrolment_id": existing["id"]})
    return insert(conn, "enrolments", {
        "enrolment_ref": enrolment_ref or next_ref(conn),
        "customer_id": customer_id, "programme_id": programme_id, "source": source,
        "created_by": created_by, "intake_text": intake_text,
        "target_start_date": target_start_date, "due_date": due_date,
    })


def set_fields(conn: sqlite3.Connection, enrolment_id: int, values: dict) -> None:
    update(conn, "enrolments", enrolment_id, values)


# ------------------------------------------------------------------ invites
def create_invite(conn: sqlite3.Connection, *, enrolment_id: int, email: str, created_by: int,
                  days_valid: int = 14) -> dict:
    conn.execute("UPDATE invites SET status = 'revoked' WHERE enrolment_id = ? AND status = 'pending'", [enrolment_id])
    code = secrets.token_urlsafe(12)
    expires = (datetime.now(timezone.utc) + timedelta(days=days_valid)).strftime("%Y-%m-%dT%H:%M:%SZ")
    invite_id = insert(conn, "invites", {"code": code, "enrolment_id": enrolment_id, "email": email,
                                         "expires_at": expires, "created_by": created_by})
    return query_one(conn, "SELECT * FROM invites WHERE id = ?", [invite_id])


def get_invite(conn: sqlite3.Connection, code: str) -> dict | None:
    return query_one(conn, """
        SELECT i.*, e.customer_id, e.enrolment_ref, p.name AS programme_name, c.full_name AS customer_name
        FROM invites i JOIN enrolments e ON e.id = i.enrolment_id
        JOIN programmes p ON p.id = e.programme_id JOIN customers c ON c.id = e.customer_id
        WHERE i.code = ?""", [code])


def latest_invite(conn: sqlite3.Connection, enrolment_id: int) -> dict | None:
    return query_one(conn, "SELECT * FROM invites WHERE enrolment_id = ? ORDER BY id DESC LIMIT 1", [enrolment_id])
