"""Portal inbox messages and in-app notifications."""
from __future__ import annotations

import sqlite3

from ..db import insert, query_all, scalar, utcnow


def create_message(conn: sqlite3.Connection, values: dict) -> int:
    return insert(conn, "messages", values)


def for_enrolment(conn: sqlite3.Connection, enrolment_id: int) -> list[dict]:
    return query_all(conn, """
        SELECT m.*, u.full_name AS author_name, u.role AS author_role, x.intent AS nlp_intent
        FROM messages m LEFT JOIN users u ON u.id = m.author_user_id
        LEFT JOIN nlp_extractions x ON x.id = m.nlp_extraction_id
        WHERE m.enrolment_id = ? ORDER BY m.created_at ASC, m.id ASC""", [enrolment_id])


def for_customer(conn: sqlite3.Connection, customer_id: int) -> list[dict]:
    return query_all(conn, """
        SELECT m.*, e.enrolment_ref, p.name AS programme_name, u.full_name AS author_name, u.role AS author_role
        FROM messages m
        JOIN enrolments e ON e.id = m.enrolment_id
        JOIN programmes p ON p.id = e.programme_id
        LEFT JOIN users u ON u.id = m.author_user_id
        WHERE e.customer_id = ? ORDER BY m.created_at DESC, m.id DESC""", [customer_id])


def mark_read_for_customer(conn: sqlite3.Connection, customer_id: int, message_id: int | None = None) -> int:
    params: list = [utcnow(), customer_id]
    extra = ""
    if message_id:
        extra = " AND m.id = ?"; params.append(message_id)
    cur = conn.execute(f"""
        UPDATE messages SET is_read = 1, read_at = ?
        WHERE id IN (SELECT m.id FROM messages m JOIN enrolments e ON e.id = m.enrolment_id
                     WHERE e.customer_id = ? AND m.direction = 'to_customer' AND m.is_read = 0{extra})""", params)
    return cur.rowcount


def inbound_for_admin(conn: sqlite3.Connection, limit: int = 100) -> list[dict]:
    return query_all(conn, """
        SELECT m.*, e.enrolment_ref, c.full_name AS customer_name, p.name AS programme_name,
               x.intent AS nlp_intent, x.document_matches_json AS nlp_matches_json
        FROM messages m
        LEFT JOIN nlp_extractions x ON x.id = m.nlp_extraction_id
        JOIN enrolments e ON e.id = m.enrolment_id
        JOIN customers c ON c.id = e.customer_id
        JOIN programmes p ON p.id = e.programme_id
        WHERE m.direction = 'from_customer'
        ORDER BY m.is_read ASC, m.created_at DESC LIMIT ?""", [limit])


# ------------------------------------------------------------- notifications
def notify(conn: sqlite3.Connection, user_ids: list[int], *, kind: str, title: str, body: str = "",
           link: str | None = None) -> None:
    for uid in user_ids:
        insert(conn, "notifications", {"user_id": uid, "kind": kind, "title": title, "body": body, "link": link})


def notifications_for(conn: sqlite3.Connection, user_id: int, limit: int = 30) -> dict:
    items = query_all(conn, "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?", [user_id, limit])
    unread = scalar(conn, "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0", [user_id])
    return {"items": items, "unread": unread}


def mark_notifications_read(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [user_id])
