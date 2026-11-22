"""Programmes and their required-document templates."""
from __future__ import annotations

import sqlite3

from ..db import insert, query_all, query_one, scalar, update
from ..errors import ConflictError, NotFoundError


def list_programmes(conn: sqlite3.Connection, *, include_inactive: bool = False) -> list[dict]:
    where = "" if include_inactive else "WHERE p.is_active = 1"
    programmes = query_all(conn, f"""
        SELECT p.*,
               (SELECT COUNT(*) FROM enrolments e WHERE e.programme_id = p.id) AS enrolment_count
        FROM programmes p {where} ORDER BY p.name""")
    docs = query_all(conn, "SELECT * FROM required_documents ORDER BY programme_id, sort_order, id")
    by_prog: dict[int, list] = {}
    for d in docs:
        by_prog.setdefault(d["programme_id"], []).append(d)
    for p in programmes:
        p["documents"] = by_prog.get(p["id"], [])
    return programmes


def get(conn: sqlite3.Connection, programme_id: int) -> dict:
    row = query_one(conn, "SELECT * FROM programmes WHERE id = ?", [programme_id])
    if not row:
        raise NotFoundError(f"Programme {programme_id} was not found.")
    row["documents"] = required_documents(conn, programme_id)
    return row


def get_by_code(conn: sqlite3.Connection, code: str) -> dict | None:
    row = query_one(conn, "SELECT * FROM programmes WHERE code = ?", [code])
    if row:
        row["documents"] = required_documents(conn, row["id"])
    return row


def required_documents(conn: sqlite3.Connection, programme_id: int) -> list[dict]:
    return query_all(conn, "SELECT * FROM required_documents WHERE programme_id = ? ORDER BY sort_order, id",
                     [programme_id])


def get_document(conn: sqlite3.Connection, doc_id: int) -> dict:
    row = query_one(conn, "SELECT * FROM required_documents WHERE id = ?", [doc_id])
    if not row:
        raise NotFoundError(f"Required document {doc_id} was not found.")
    return row


def create(conn: sqlite3.Connection, values: dict) -> int:
    if query_one(conn, "SELECT id FROM programmes WHERE code = ? OR name = ?", [values["code"], values["name"]]):
        raise ConflictError("A programme with this code or name already exists.", {"code": "Already exists."})
    return insert(conn, "programmes", values)


def update_programme(conn: sqlite3.Connection, programme_id: int, values: dict) -> None:
    get(conn, programme_id)
    update(conn, "programmes", programme_id, values)


def add_document(conn: sqlite3.Connection, programme_id: int, values: dict) -> int:
    get(conn, programme_id)
    if query_one(conn, "SELECT id FROM required_documents WHERE programme_id = ? AND doc_code = ?",
                 [programme_id, values["doc_code"]]):
        raise ConflictError("This programme already has a document with that code.", {"doc_code": "Already exists."})
    if "sort_order" not in values:
        values["sort_order"] = (scalar(conn, "SELECT COALESCE(MAX(sort_order), 0) FROM required_documents "
                                             "WHERE programme_id = ?", [programme_id]) or 0) + 1
    return insert(conn, "required_documents", {"programme_id": programme_id, **values})


def update_document(conn: sqlite3.Connection, doc_id: int, values: dict) -> None:
    get_document(conn, doc_id)
    update(conn, "required_documents", doc_id, values)


def delete_document(conn: sqlite3.Connection, doc_id: int) -> None:
    get_document(conn, doc_id)
    used = scalar(conn, "SELECT COUNT(*) FROM document_submissions WHERE required_document_id = ?", [doc_id])
    if used:
        raise ConflictError("This document already has submissions. Mark it optional instead of deleting it.")
    conn.execute("DELETE FROM required_documents WHERE id = ?", [doc_id])
