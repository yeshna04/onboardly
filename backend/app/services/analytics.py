"""Dashboard statistics and reports.

Simple counts come straight from SQL; the multi-step analyses (document
bottlenecks, cycle time, programme funnel) use pandas DataFrames built from
SQL queries.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

import pandas as pd

from ..db import query_all, scalar


def dashboard_stats(conn: sqlite3.Connection) -> dict:
    today = datetime.now(timezone.utc).date().isoformat()
    by_status = {r["status"]: r["n"] for r in query_all(conn,
                 "SELECT status, COUNT(*) AS n FROM enrolments GROUP BY status")}
    active_where = "status NOT IN ('completed','cancelled')"
    return {
        "by_status": {s: by_status.get(s, 0) for s in
                      ("new", "awaiting_docs", "ready_for_review", "completed", "cancelled")},
        "active_enrolments": scalar(conn, f"SELECT COUNT(*) FROM enrolments WHERE {active_where}"),
        "avg_completion_pct": round(scalar(conn, f"SELECT COALESCE(AVG(completion_pct),0) FROM enrolments "
                                                 f"WHERE {active_where}") or 0, 1),
        "awaiting_verification": scalar(conn, "SELECT COUNT(*) FROM document_submissions s JOIN enrolments e "
                                              "ON e.id = s.enrolment_id WHERE s.status IN ('submitted','needs_review') "
                                              "AND e.status != 'cancelled'"),
        "needs_review": scalar(conn, "SELECT COUNT(*) FROM document_submissions WHERE status = 'needs_review'"),
        "pending_drafts": scalar(conn, "SELECT COUNT(*) FROM reminder_drafts WHERE status = 'draft'"),
        "unread_customer_messages": scalar(conn, "SELECT COUNT(*) FROM messages WHERE direction = 'from_customer' "
                                                 "AND is_read = 0"),
        "overdue": scalar(conn, f"SELECT COUNT(*) FROM enrolments WHERE {active_where} AND due_date < ?", [today]),
        "llm_calls_24h": scalar(conn, "SELECT COUNT(*) FROM llm_interactions WHERE created_at >= "
                                      "strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')"),
        "attention": query_all(conn, f"""
            SELECT e.id, e.enrolment_ref, e.status, e.completion_pct, e.due_date,
                   c.full_name AS customer_name, p.name AS programme_name,
                   CASE WHEN e.due_date < ? THEN 'overdue'
                        WHEN EXISTS (SELECT 1 FROM document_submissions s WHERE s.enrolment_id = e.id
                                     AND s.status = 'needs_review') THEN 'needs_review'
                        WHEN e.status = 'ready_for_review' THEN 'ready_for_review'
                        ELSE 'due_soon' END AS reason
            FROM enrolments e JOIN customers c ON c.id = e.customer_id JOIN programmes p ON p.id = e.programme_id
            WHERE e.{active_where} AND (e.due_date < date(?, '+4 day')
                   OR e.status = 'ready_for_review'
                   OR EXISTS (SELECT 1 FROM document_submissions s WHERE s.enrolment_id = e.id
                              AND s.status = 'needs_review'))
            ORDER BY (e.due_date < ?) DESC, e.due_date ASC LIMIT 8""", [today, today, today]),
        "recent_activity": query_all(conn, """
            SELECT a.id, a.action, a.actor_role, a.created_at, a.enrolment_id, a.details_json,
                   u.full_name AS actor_name, e.enrolment_ref, c.full_name AS customer_name
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.actor_user_id
            LEFT JOIN enrolments e ON e.id = a.enrolment_id
            LEFT JOIN customers c ON c.id = e.customer_id
            WHERE a.action NOT LIKE 'auth.%'
            ORDER BY a.id DESC LIMIT 12"""),
        "by_programme": programme_breakdown(conn),
        "document_bottlenecks": document_bottlenecks(conn),
    }


def programme_breakdown(conn: sqlite3.Connection) -> list[dict]:
    df = pd.read_sql_query("""
        SELECT p.code, p.name, e.status, e.completion_pct
        FROM programmes p LEFT JOIN enrolments e ON e.programme_id = p.id""", conn)
    out = []
    for (code, name), grp in df.groupby(["code", "name"], sort=True):
        enrolled = grp.dropna(subset=["status"])
        active = enrolled[~enrolled["status"].isin(["completed", "cancelled"])]
        out.append({
            "code": code, "name": name,
            "enrolments": int(len(enrolled)),
            "active": int(len(active)),
            "completed": int((enrolled["status"] == "completed").sum()),
            "avg_completion_pct": round(float(active["completion_pct"].mean()), 1) if len(active) else 0.0,
        })
    return out


def document_bottlenecks(conn: sqlite3.Connection, top: int = 6) -> list[dict]:
    """Which required documents are most often outstanding on the latest check of active enrolments."""
    df = pd.read_sql_query("""
        SELECT oc.enrolment_id, oc.missing_json
        FROM onboarding_checks oc
        JOIN (SELECT enrolment_id, MAX(id) AS id FROM onboarding_checks GROUP BY enrolment_id) last
             ON last.id = oc.id
        JOIN enrolments e ON e.id = oc.enrolment_id
        WHERE e.status NOT IN ('completed', 'cancelled')""", conn)
    if df.empty:
        return []
    df["missing"] = df["missing_json"].apply(lambda s: json.loads(s or "[]"))
    exploded = df.explode("missing").dropna(subset=["missing"])
    if exploded.empty:
        return []
    exploded["name"] = exploded["missing"].apply(lambda m: m["name"])
    exploded["state"] = exploded["missing"].apply(lambda m: m["state"])
    counts = (exploded.groupby("name")
              .agg(outstanding=("enrolment_id", "nunique"),
                   rejected=("state", lambda s: int((s == "rejected").sum())))
              .sort_values("outstanding", ascending=False).head(top).reset_index())
    return counts.to_dict(orient="records")


def onboarding_report(conn: sqlite3.Connection) -> pd.DataFrame:
    """Flat per-enrolment report (exported as CSV from the admin portal)."""
    df = pd.read_sql_query("""
        SELECT e.enrolment_ref, c.customer_ref, c.full_name AS customer, c.country,
               p.name AS programme, e.status, e.completion_pct, e.source,
               e.created_at, e.due_date, e.completed_at,
               (SELECT COUNT(*) FROM document_submissions s WHERE s.enrolment_id = e.id
                  AND s.status != 'superseded') AS documents_received,
               (SELECT COUNT(*) FROM reminder_drafts r WHERE r.enrolment_id = e.id
                  AND r.status = 'published') AS reminders_sent
        FROM enrolments e JOIN customers c ON c.id = e.customer_id JOIN programmes p ON p.id = e.programme_id
        ORDER BY e.enrolment_ref""", conn)
    created = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
    completed = pd.to_datetime(df["completed_at"], utc=True, errors="coerce")
    df["days_to_complete"] = (completed - created).dt.days
    today = pd.Timestamp.now(tz="UTC").normalize()
    due = pd.to_datetime(df["due_date"], utc=True, errors="coerce")
    df["overdue"] = (due < today) & ~df["status"].isin(["completed", "cancelled"])
    return df
