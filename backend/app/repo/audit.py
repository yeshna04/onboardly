"""Append-only audit log."""
from __future__ import annotations

import sqlite3
from typing import Any

from ..db import insert, query_all, scalar, to_json, from_json


def record(conn: sqlite3.Connection, *, action: str, entity_type: str, entity_id: int | None = None,
           enrolment_id: int | None = None, actor: dict | None = None, details: dict | None = None,
           ip_address: str | None = None) -> int:
    """Write one audit row. ``actor`` is the current user dict (or None for system)."""
    return insert(conn, "audit_log", {
        "actor_user_id": actor["id"] if actor else None,
        "actor_role": actor["role"] if actor else "system",
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "enrolment_id": enrolment_id,
        "details_json": to_json(details or {}),
        "ip_address": ip_address,
    })


def list_entries(conn: sqlite3.Connection, *, enrolment_id: int | None = None, action: str | None = None,
                 actor_role: str | None = None, search: str | None = None,
                 limit: int = 50, offset: int = 0) -> dict[str, Any]:
    where, params = [], []
    if enrolment_id:
        where.append("a.enrolment_id = ?"); params.append(enrolment_id)
    if action:
        where.append("a.action LIKE ?"); params.append(f"{action}%")
    if actor_role:
        where.append("a.actor_role = ?"); params.append(actor_role)
    if search:
        where.append("(a.action LIKE ? OR a.details_json LIKE ? OR u.full_name LIKE ?)")
        params += [f"%{search}%"] * 3
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = scalar(conn, f"SELECT COUNT(*) FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id {clause}", params)
    rows = query_all(conn, f"""
        SELECT a.*, u.full_name AS actor_name, e.enrolment_ref
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        LEFT JOIN enrolments e ON e.id = a.enrolment_id
        {clause}
        ORDER BY a.id DESC LIMIT ? OFFSET ?""", [*params, limit, offset])
    for r in rows:
        r["details"] = from_json(r.pop("details_json"), {})
    return {"items": rows, "total": total}
