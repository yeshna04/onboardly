"""Create (or reset) the SQLite database and load synthetic sample data.

Usage:
    python seed.py            # rebuild db/onboarding.db from scratch
    python seed.py --keep     # only create the schema if the DB is missing (used on Render start)

All sample data is synthetic (see data/sample/*). Demo logins are printed at the end.
"""
from __future__ import annotations

import argparse
import os
import secrets
import dataclasses
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import BACKEND_DIR, Config
from app.connectors.crm_import import import_customers
from app.db import connect, init_db, insert, query_one, update
from app.repo import audit
from app.repo import enrolments as enrol_repo
from app.repo import programmes as prog_repo
from app.repo import users as users_repo
from app.llm.factory import make_client
from app.nlp import pipeline as nlp
from app.services import ai_workflow, checklist
from app.services.documents import record_extraction

SAMPLE_DIR = BACKEND_DIR / "data" / "sample"

# The seeded officer account is NOT a public demo login. Set ADMIN_EMAIL / ADMIN_PASSWORD in the
# environment (e.g. Render); otherwise a random password is generated and printed once.
_ADMIN: dict | None = None


def admin_account() -> dict:
    """Read after Config.from_env() so values in backend/.env are honoured; generated once per run."""
    global _ADMIN
    if _ADMIN is None:
        _ADMIN = {"email": os.environ.get("ADMIN_EMAIL", "admin@demo.test"),
                  "password": os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(12),
                  "full_name": "Olivia Grant (Onboarding Officer)"}
    return _ADMIN
# Shared, read-only learner demo logins (synthetic data).
DEMO_CUSTOMER_PASSWORD = "LearnerDemo2026"


def ts(days_ago: float = 0, hours: float = 0) -> str:
    moment = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=hours)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def day(offset_days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=offset_days)).date().isoformat()


def reset_database(cfg: Config) -> None:
    for suffix in ("", "-wal", "-shm"):
        Path(str(cfg.database_path) + suffix).unlink(missing_ok=True)


def seed(cfg: Config) -> dict:
    cfg.database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(cfg.database_path)
    init_db(conn, cfg.schema_path)

    # --- admin
    admin_id = users_repo.create(conn, role="admin", **admin_account())
    admin = {"id": admin_id, "role": "admin"}

    # --- programmes + required documents
    programmes = json.loads((SAMPLE_DIR / "programmes.json").read_text(encoding="utf-8"))["programmes"]
    prog_ids: dict[str, int] = {}
    for p in programmes:
        pid = prog_repo.create(conn, {k: p[k] for k in ("code", "name", "description", "category",
                                                         "duration_weeks", "keywords")})
        prog_ids[p["code"]] = pid
        for order, d in enumerate(p["documents"], start=1):
            prog_repo.add_document(conn, pid, {**d, "sort_order": order})

    # --- customers via the CRM connector (pandas)
    report = import_customers(conn, SAMPLE_DIR / "crm_customers.csv", filename="crm_customers.csv",
                              actor=None, source_label="seed")
    customers = {r["customer_ref"]: r for r in
                 (dict(x) for x in conn.execute("SELECT * FROM customers").fetchall())}

    # --- customer logins (every synthetic customer can sign in to the portal)
    for c in customers.values():
        uid = users_repo.create(conn, email=c["email"], password=DEMO_CUSTOMER_PASSWORD,
                                full_name=c["full_name"], role="customer", customer_id=c["id"],
                                is_demo=True)
        update(conn, "users", uid, {"created_at": c["created_at"]})

    # --- enrolments + submission history
    all_programmes = prog_repo.list_programmes(conn)
    enrolment_data = json.loads((SAMPLE_DIR / "enrolments.json").read_text(encoding="utf-8"))["enrolments"]
    for idx, e in enumerate(enrolment_data, start=1):
        cust = customers[e["customer_ref"]]
        programme = prog_repo.get(conn, prog_ids[e["programme"]])
        docs = {d["doc_code"]: d for d in programme["documents"]}
        created = ts(e["created_days_ago"], hours=idx)
        eid = enrol_repo.create(conn, customer_id=cust["id"], programme_id=programme["id"],
                                source="seed", created_by=admin_id, intake_text=e["intake_text"],
                                due_date=day(e["due_in_days"]), target_start_date=day(e["due_in_days"] + 14))
        update(conn, "enrolments", eid, {"created_at": created, "updated_at": created})
        audit.record(conn, action="enrolment.created", entity_type="enrolment", entity_id=eid,
                     enrolment_id=eid, actor=admin, details={"source": "seed", "programme": e["programme"]})
        # NLP on the intake email (stored for traceability; seed submissions below are the "real" history)
        analysis = nlp.analyze_text(e["intake_text"], programme, all_programmes)
        xid = record_extraction(conn, enrolment_id=eid, submission_id=None, source_type="intake_text",
                                original=e["intake_text"], analysis=analysis)
        update(conn, "nlp_extractions", xid, {"created_at": created})
        update(conn, "enrolments", eid, {"detected_service_code": analysis["detected_service"]["code"],
                                         "updated_at": created})
        customer_user = query_one(conn, "SELECT id FROM users WHERE customer_id = ?", [cust["id"]])

        for s in e["submissions"]:
            doc = docs[s["doc_code"]]
            when = ts(s["days_ago"], hours=idx)
            sid = insert(conn, "document_submissions", {
                "enrolment_id": eid, "required_document_id": doc["id"], "channel": "seed",
                "original_filename": s["filename"], "mime_type": None, "file_size": None,
                "customer_note": s.get("note") or None, "detected_doc_code": s["doc_code"],
                "match_confidence": s.get("confidence", 0.9), "customer_confirmed": 1,
                "status": s["status"], "rejection_reason": s.get("rejection_reason"),
                "uploaded_by": customer_user["id"],
                "verified_by": admin_id if s["status"] in ("verified", "rejected") else None,
                "verified_at": ts(s["days_ago"] - 1) if s["status"] in ("verified", "rejected") else None,
                "created_at": when, "updated_at": when,
            })
            audit.record(conn, action="submission.created", entity_type="document_submission", entity_id=sid,
                         enrolment_id=eid, actor={"id": customer_user["id"], "role": "customer"},
                         details={"doc_code": s["doc_code"], "filename": s["filename"]})

        result = checklist.run_check(conn, eid, actor=None, reason="seed")
        if e.get("completed") and result["all_verified"]:
            update(conn, "enrolments", eid, {"status": "completed", "completed_by": admin_id,
                                             "completed_at": ts(e["created_days_ago"] - 3)})
            audit.record(conn, action="enrolment.completed", entity_type="enrolment", entity_id=eid,
                         enrolment_id=eid, actor=admin, details={"source": "seed"})
    conn.commit()
    seed_conversations(conn, cfg, admin_id)

    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in
              ("customers", "users", "programmes", "required_documents", "enrolments",
               "document_submissions", "onboarding_checks", "audit_log")}
    conn.close()
    return {"counts": counts, "crm_report": {k: report[k] for k in ("total_rows", "imported", "rejected")}}


def seed_conversations(conn, cfg: Config, admin_id: int) -> None:
    """A few portal messages and one draft waiting for review, so every screen has data."""
    admin = {"id": admin_id, "role": "admin"}
    ref = {r["customer_ref"]: r for r in (dict(x) for x in conn.execute(
        "SELECT e.id, e.programme_id, c.customer_ref, u.id AS user_id FROM enrolments e "
        "JOIN customers c ON c.id = e.customer_id JOIN users u ON u.customer_id = c.id"))}

    # officer message to Tomasz about the rejected experience letter (human-written)
    t = ref["CUS-0004"]
    mid = insert(conn, "messages", {"enrolment_id": t["id"], "direction": "to_customer",
                                    "subject": "Your experience letter needs one more detail",
                                    "body": "Hi Tomasz,\n\nThanks for sending your experience letter. Unfortunately it "
                                            "doesn't state how many months of project management experience you have, "
                                            "which the exam body requires. Could you ask your employer for an updated "
                                            "letter and upload it in the portal?\n\nBest wishes,\nThe Onboarding Team",
                                    "author_user_id": admin_id, "is_read": 1, "created_at": ts(15)})
    audit.record(conn, action="message.published", entity_type="message", entity_id=mid, enrolment_id=t["id"],
                 actor=admin, details={"author": "officer"})

    # customer reply from Aria (analysed by NLP for intent)
    a = ref["CUS-0001"]
    reply = ("Hi! My IELTS test is this Saturday, I will upload the score report next week. "
             "Is my transcript okay? Also I haven't signed the learner agreement yet - where do I find it?")
    programme = prog_repo.get(conn, a["programme_id"])
    analysis = nlp.analyze_text(reply, programme, prog_repo.list_programmes(conn))
    xid = record_extraction(conn, enrolment_id=a["id"], submission_id=None, source_type="customer_reply",
                            original=reply, analysis=analysis)
    insert(conn, "messages", {"enrolment_id": a["id"], "direction": "from_customer",
                              "subject": "Question about my documents", "body": reply,
                              "author_user_id": a["user_id"], "nlp_extraction_id": xid, "created_at": ts(1)})
    conn.commit()

    # one reminder draft waiting in the review queue (template, so seeding never calls the API)
    offline = dataclasses.replace(cfg, anthropic_api_key="", gemini_api_key="")
    ai_workflow.run_ai_task(conn, offline, enrolment_id=ref["CUS-0012"]["id"], task="draft_reminder",
                            actor=admin, tone="formal", channel="email", client=make_client(offline))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keep", action="store_true", help="do nothing if the database already exists")
    args = parser.parse_args(argv)
    cfg = Config.from_env()

    if args.keep and cfg.database_path.exists():
        print(f"Database already exists at {cfg.database_path} – keeping it.")
        return 0
    reset_database(cfg)
    result = seed(cfg)
    print(f"Seeded {cfg.database_path}")
    for table, n in result["counts"].items():
        print(f"  {table:<22} {n}")
    print("\nLogins:")
    if os.environ.get("ADMIN_PASSWORD"):
        print(f"  Admin portal    : {admin_account()['email']} / (password from ADMIN_PASSWORD)")
    else:
        print(f"  Admin portal    : {admin_account()['email']} / {admin_account()['password']}  (random – save it now)")
    print(f"  Customer portal : aria.kestrel@learner.test / {DEMO_CUSTOMER_PASSWORD}  (any *@learner.test customer works)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
