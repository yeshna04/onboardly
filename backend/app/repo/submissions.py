"""Document submissions."""
from __future__ import annotations

import sqlite3

from ..db import insert, query_all, query_one, update
from ..errors import NotFoundError

_SELECT = """
    SELECT s.*, rd.doc_code, rd.name AS document_name,
           up.full_name AS uploaded_by_name, up.role AS uploaded_by_role,
           vf.full_name AS verified_by_name
    FROM document_submissions s
    LEFT JOIN required_documents rd ON rd.id = s.required_document_id
    LEFT JOIN users up ON up.id = s.uploaded_by
    LEFT JOIN users vf ON vf.id = s.verified_by
"""


def get(conn: sqlite3.Connection, submission_id: int) -> dict:
    row = query_one(conn, _SELECT + " WHERE s.id = ?", [submission_id])
    if not row:
        raise NotFoundError(f"Submission {submission_id} was not found.")
    return row


def for_enrolment(conn: sqlite3.Connection, enrolment_id: int) -> list[dict]:
    return query_all(conn, _SELECT + " WHERE s.enrolment_id = ? ORDER BY s.created_at DESC, s.id DESC",
                     [enrolment_id])


def create(conn: sqlite3.Connection, values: dict) -> int:
    return insert(conn, "document_submissions", values)


def set_fields(conn: sqlite3.Connection, submission_id: int, values: dict) -> None:
    update(conn, "document_submissions", submission_id, values)


def supersede_older(conn: sqlite3.Connection, enrolment_id: int, required_document_id: int, keep_id: int) -> None:
    """When a new file for the same document arrives, older non-final ones are superseded."""
    conn.execute("""UPDATE document_submissions SET status = 'superseded'
                    WHERE enrolment_id = ? AND required_document_id = ? AND id != ?
                      AND status IN ('pending', 'submitted', 'needs_review', 'rejected')""",
                 [enrolment_id, required_document_id, keep_id])


def verification_queue(conn: sqlite3.Connection, limit: int = 100) -> list[dict]:
    return query_all(conn, """
        SELECT s.*, rd.doc_code, rd.name AS document_name,
               e.enrolment_ref, e.id AS enrolment_id, c.full_name AS customer_name,
               p.name AS programme_name, up.role AS uploaded_by_role, up.full_name AS uploaded_by_name
        FROM document_submissions s
        JOIN enrolments e ON e.id = s.enrolment_id
        JOIN customers c ON c.id = e.customer_id
        JOIN programmes p ON p.id = e.programme_id
        LEFT JOIN required_documents rd ON rd.id = s.required_document_id
        LEFT JOIN users up ON up.id = s.uploaded_by
        WHERE s.status IN ('submitted', 'needs_review') AND e.status != 'cancelled'
        ORDER BY (s.status = 'needs_review') DESC, s.created_at ASC
        LIMIT ?""", [limit])
