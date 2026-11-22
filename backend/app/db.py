"""SQLite access layer built on the standard-library ``sqlite3`` module.

* ``connect()`` opens a connection with foreign keys on and ``Row`` results.
* ``get_db()`` returns the per-request connection stored on ``flask.g``.
* ``init_db()`` (re)creates the schema from ``db/schema.sql``.
* Small helpers (``query_one``, ``query_all``, ``execute``, ``transaction``)
  keep the repository modules short and always use parameterised SQL.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from flask import current_app, g


def utcnow() -> str:
    """Current UTC time as ISO-8601 text (the format used in every table)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), detect_types=0, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection, schema_path: Path) -> None:
    conn.executescript(schema_path.read_text(encoding="utf-8"))
    conn.commit()


def migrate(conn: sqlite3.Connection) -> None:
    """Bring an older database up to date with schema.sql (additive changes only)."""
    def columns(table: str) -> set[str]:
        return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}

    cols = columns("users")
    if cols and "is_demo" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))")
        # the seeded synthetic learners are the shared demo logins
        conn.execute("UPDATE users SET is_demo = 1 WHERE role = 'customer' AND email LIKE '%@learner.test'")
    cols = columns("enrolments")
    if cols and "cancellation_reason" not in cols:
        conn.execute("ALTER TABLE enrolments ADD COLUMN cancelled_at TEXT")
        conn.execute("ALTER TABLE enrolments ADD COLUMN cancellation_reason TEXT")
        # recover reason + time of earlier cancellations from the audit log
        conn.execute("""
            UPDATE enrolments SET
              cancellation_reason = (SELECT json_extract(a.details_json, '$.reason') FROM audit_log a
                                     WHERE a.action = 'enrolment.cancelled' AND a.entity_id = enrolments.id
                                     ORDER BY a.id DESC LIMIT 1),
              cancelled_at = (SELECT a.created_at FROM audit_log a
                              WHERE a.action = 'enrolment.cancelled' AND a.entity_id = enrolments.id
                              ORDER BY a.id DESC LIMIT 1)
            WHERE status = 'cancelled'""")
    # v1 (one-time): self-service enrolments created before they got a default deadline
    if conn.execute("PRAGMA user_version").fetchone()[0] < 1 and columns("enrolments"):
        conn.execute("""UPDATE enrolments SET due_date = date(created_at, '+21 day')
                        WHERE source = 'self_service' AND due_date IS NULL
                          AND status NOT IN ('completed', 'cancelled')""")
        conn.execute("PRAGMA user_version = 1")
    conn.commit()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = connect(current_app.config["APP_CONFIG"].database_path)
    return g.db


def close_db(_exc: BaseException | None = None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


# ---------------------------------------------------------------- helpers
def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict]:
    return [dict(r) for r in rows]


def query_one(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> dict | None:
    return row_to_dict(conn.execute(sql, tuple(params)).fetchone())


def query_all(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> list[dict]:
    return rows_to_dicts(conn.execute(sql, tuple(params)).fetchall())


def scalar(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> Any:
    row = conn.execute(sql, tuple(params)).fetchone()
    return row[0] if row is not None else None


def execute(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> int:
    """Run an INSERT/UPDATE/DELETE and return lastrowid (for inserts)."""
    cur = conn.execute(sql, tuple(params))
    return cur.lastrowid


def insert(conn: sqlite3.Connection, table: str, values: dict[str, Any]) -> int:
    """Insert a dict as a row. Table/column names come from code, never user input."""
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    return execute(conn, f"INSERT INTO {table} ({cols}) VALUES ({marks})", values.values())


def update(conn: sqlite3.Connection, table: str, row_id: int, values: dict[str, Any]) -> None:
    if not values:
        return
    sets = ", ".join(f"{c} = ?" for c in values)
    execute(conn, f"UPDATE {table} SET {sets} WHERE id = ?", [*values.values(), row_id])


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Commit on success, roll back on any exception."""
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def from_json(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default
