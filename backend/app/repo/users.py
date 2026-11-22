"""User accounts (admin + customer logins)."""
from __future__ import annotations

import sqlite3

from werkzeug.security import check_password_hash, generate_password_hash

from ..db import insert, query_one, update, utcnow
from ..errors import ConflictError

PUBLIC_FIELDS = "id, email, full_name, role, customer_id, is_active, is_demo, last_login_at, created_at"


def get(conn: sqlite3.Connection, user_id: int) -> dict | None:
    return query_one(conn, f"SELECT {PUBLIC_FIELDS} FROM users WHERE id = ?", [user_id])


def get_by_email_with_hash(conn: sqlite3.Connection, email: str) -> dict | None:
    return query_one(conn, "SELECT * FROM users WHERE email = ?", [email])


def get_by_customer(conn: sqlite3.Connection, customer_id: int) -> dict | None:
    return query_one(conn, f"SELECT {PUBLIC_FIELDS} FROM users WHERE customer_id = ?", [customer_id])


def create(conn: sqlite3.Connection, *, email: str, password: str, full_name: str, role: str,
           customer_id: int | None = None, is_demo: bool = False) -> int:
    if query_one(conn, "SELECT id FROM users WHERE email = ?", [email]):
        raise ConflictError("An account with this email already exists.", {"email": "Already registered — try signing in."})
    return insert(conn, "users", {
        "email": email,
        "password_hash": generate_password_hash(password),
        "full_name": full_name,
        "role": role,
        "customer_id": customer_id,
        "is_demo": int(is_demo),
    })


def verify_password(user_row: dict, password: str) -> bool:
    return bool(user_row) and check_password_hash(user_row["password_hash"], password)


def touch_login(conn: sqlite3.Connection, user_id: int) -> None:
    update(conn, "users", user_id, {"last_login_at": utcnow()})


def admin_ids(conn: sqlite3.Connection) -> list[int]:
    return [r[0] for r in conn.execute("SELECT id FROM users WHERE role = 'admin' AND is_active = 1")]
