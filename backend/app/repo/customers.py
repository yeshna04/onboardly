"""Customers (CRM mirror)."""
from __future__ import annotations

import sqlite3

from ..db import insert, query_all, query_one, scalar, update
from ..errors import ConflictError, NotFoundError


def next_ref(conn: sqlite3.Connection) -> str:
    last = scalar(conn, "SELECT customer_ref FROM customers WHERE customer_ref LIKE 'CUS-%' "
                        "ORDER BY CAST(substr(customer_ref, 5) AS INTEGER) DESC LIMIT 1")
    number = int(last[4:]) + 1 if last and last[4:].isdigit() else 1
    return f"CUS-{number:04d}"


def get(conn: sqlite3.Connection, customer_id: int) -> dict:
    row = query_one(conn, "SELECT * FROM customers WHERE id = ?", [customer_id])
    if not row:
        raise NotFoundError(f"Customer {customer_id} was not found.")
    return row


def find_by_email(conn: sqlite3.Connection, email: str) -> dict | None:
    return query_one(conn, "SELECT * FROM customers WHERE email = ?", [email])


def find_by_ref(conn: sqlite3.Connection, ref: str) -> dict | None:
    return query_one(conn, "SELECT * FROM customers WHERE customer_ref = ?", [ref])


def create(conn: sqlite3.Connection, *, full_name: str, email: str, phone: str | None = None,
           country: str | None = None, source: str = "admin", customer_ref: str | None = None) -> int:
    if find_by_email(conn, email):
        raise ConflictError("A customer with this email already exists.", {"email": "Already exists."})
    return insert(conn, "customers", {
        "customer_ref": customer_ref or next_ref(conn),
        "full_name": full_name, "email": email, "phone": phone, "country": country, "source": source,
    })


def update_customer(conn: sqlite3.Connection, customer_id: int, values: dict) -> None:
    get(conn, customer_id)
    if "email" in values:
        other = find_by_email(conn, values["email"])
        if other and other["id"] != customer_id:
            raise ConflictError("Another customer already uses this email.", {"email": "Already in use."})
    update(conn, "customers", customer_id, values)


def search(conn: sqlite3.Connection, q: str | None = None, limit: int = 50) -> list[dict]:
    params: list = []
    where = ""
    if q:
        where = "WHERE c.full_name LIKE ? OR c.email LIKE ? OR c.customer_ref LIKE ?"
        params = [f"%{q}%"] * 3
    return query_all(conn, f"""
        SELECT c.*,
               (SELECT COUNT(*) FROM enrolments e WHERE e.customer_id = c.id) AS enrolment_count,
               (SELECT COUNT(*) FROM users u WHERE u.customer_id = c.id) AS has_login
        FROM customers c {where}
        ORDER BY c.full_name LIMIT ?""", [*params, limit])
