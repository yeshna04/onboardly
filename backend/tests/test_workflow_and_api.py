"""End-to-end workflow on a seeded synthetic DB with a mocked LLM, plus the HTTP API (auth, CSRF, roles, review)."""
from __future__ import annotations

import io
import json
import unittest

from app import create_app
from app.db import connect, from_json, query_one, scalar
from app.errors import NotFoundError, UnsupportedRequestError
from app.llm import fallback
from app.llm.client import LLMResult
from app.llm.context import build_context
from app.repo import enrolments as enrol_repo
from app.security import login_limiter
from app.services import ai_workflow, checklist

from .support import (ADMIN_EMAIL, ADMIN_PASSWORD, LEARNER_EMAIL, LEARNER_PASSWORD, ScriptedLLM, make_config, ok,
                      seeded_db)

ADMIN = {"id": 1, "role": "admin"}


def open_enrolment(conn) -> dict:
    """An enrolment with documents still waiting on the customer."""
    for row in conn.execute("SELECT id FROM enrolments WHERE status IN ('new', 'awaiting_docs') ORDER BY id"):
        e = enrol_repo.get(conn, row["id"])
        if checklist.checklist_for(conn, e)["outstanding"]:
            return e
    raise AssertionError("seed data has no open enrolment")


class AiWorkflowTests(unittest.TestCase):

    def setUp(self):
        self.cfg = make_config(seeded_db())
        self.conn = connect(self.cfg.database_path)
        self.enrolment = open_enrolment(self.conn)
        context = build_context(self.conn, self.enrolment, checklist.checklist_for(self.conn, self.enrolment))
        self.good_reply = fallback.reminder(context, "friendly", "email")   # grounded in the real checklist

    def tearDown(self):
        self.conn.close()

    def run_task(self, llm, task="draft_reminder", enrolment_id=None):
        return ai_workflow.run_ai_task(self.conn, self.cfg, enrolment_id=enrolment_id or self.enrolment["id"],
                                       task=task, actor=ADMIN, tone="friendly", channel="email", client=llm)

    def test_tc21_end_to_end_reminder_is_saved_as_a_draft_with_provider_metadata(self):
        """TC21 normal: read → checklist → NLP → prompt → LLM → validate → save; draft waits for human review."""
        llm = ScriptedLLM(ok(self.good_reply))
        out = self.run_task(llm)
        self.assertFalse(out["is_fallback"])
        self.assertEqual([s["name"] for s in out["steps"]],
                         ["read_enrolment", "compare_checklist", "nlp_evidence", "build_prompt", "llm_call",
                          "validate", "save"])
        self.assertIn("<onboarding_context>", llm.calls[0]["messages"][0]["content"])
        row = query_one(self.conn, "SELECT * FROM llm_interactions WHERE id = ?", [out["interaction"]["id"]])
        self.assertEqual((row["status"], row["provider"], row["model"]), ("success", "anthropic", "claude-opus-5-5"))
        self.assertEqual((row["input_tokens"], row["request_id"], row["prompt_version"]), (900, "req_test_123", "v2"))
        draft = query_one(self.conn, "SELECT * FROM reminder_drafts WHERE id = ?", [out["draft_id"]])
        self.assertEqual(draft["status"], "draft")                     # nothing is sent automatically
        self.assertEqual(scalar(self.conn, "SELECT COUNT(*) FROM messages WHERE reminder_draft_id = ?",
                                [out["draft_id"]]), 0)
        self.assertEqual(scalar(self.conn, "SELECT COUNT(*) FROM audit_log WHERE action = 'ai.draft_reminder' "
                                           "AND entity_id = ?", [row["id"]]), 1)

    def test_tc22_ungrounded_output_is_repaired_once_then_falls_back_to_template(self):
        """TC22 recovery: two hallucinated replies → one repair attempt, then a labelled template draft."""
        bad = dict(self.good_reply, mentioned_doc_codes=["VISA_LETTER"], body="Send your visa letter at www.x.com")
        llm = ScriptedLLM(ok(bad), ok(bad))
        out = self.run_task(llm)
        self.assertEqual(len(llm.calls), 2)
        self.assertIn("failed these checks", llm.calls[1]["messages"][-1]["content"])
        self.assertTrue(out["is_fallback"])
        row = query_one(self.conn, "SELECT status, attempts, validation_errors_json FROM llm_interactions "
                                   "WHERE id = ?", [out["interaction"]["id"]])
        self.assertEqual((row["status"], row["attempts"]), ("validation_failed", 2))
        self.assertTrue(from_json(row["validation_errors_json"])["errors"])
        draft = query_one(self.conn, "SELECT is_fallback FROM reminder_drafts WHERE id = ?", [out["draft_id"]])
        self.assertEqual(draft["is_fallback"], 1)

    def test_tc23_api_failure_still_produces_a_safe_explanation(self):
        """TC23 failure: provider timeout → template explanation, error and status 'timeout' stored for audit."""
        llm = ScriptedLLM(LLMResult(status="timeout", model="claude-opus-5-5", error="Claude did not answer within 45s."))
        out = self.run_task(llm, task="explain_outstanding")
        self.assertTrue(out["is_fallback"])
        self.assertIn(out["output"]["risk_level"], ("low", "medium", "high"))
        row = query_one(self.conn, "SELECT status, error_message FROM llm_interactions WHERE id = ?",
                        [out["interaction"]["id"]])
        self.assertEqual(row["status"], "timeout")
        self.assertIn("45s", row["error_message"])

    def test_tc24_no_matching_record_and_unsupported_requests_are_refused(self):
        """TC24 edge: unknown enrolment → NotFoundError; reminder for a completed enrolment → UnsupportedRequestError."""
        with self.assertRaises(NotFoundError):
            self.run_task(ScriptedLLM(), enrolment_id=999_999)
        completed = scalar(self.conn, "SELECT id FROM enrolments WHERE status = 'completed' LIMIT 1")
        self.assertIsNotNone(completed, "seed data should include a completed enrolment")
        llm = ScriptedLLM()
        with self.assertRaises(UnsupportedRequestError):
            self.run_task(llm, enrolment_id=completed)
        self.assertEqual(llm.calls, [])                                  # the API was never called


class ApiTests(unittest.TestCase):
    H = {"X-Requested-With": "fetch"}

    def setUp(self):
        login_limiter.reset()
        self.cfg = make_config(seeded_db())
        self.app = create_app(self.cfg)
        self.client = self.app.test_client()

    def login(self, email, password):
        return self.client.post("/api/auth/login", json={"email": email, "password": password}, headers=self.H)

    def test_tc25_health_and_login_rules(self):
        """TC25: health check works; wrong password → 401; officer login → 200; learner can't open admin API."""
        health = self.client.get("/api/health").get_json()
        self.assertEqual((health["status"], health["database"]), ("ok", "ok"))
        self.assertEqual(self.login(ADMIN_EMAIL, "WrongPass123").status_code, 401)
        self.assertEqual(self.login(LEARNER_EMAIL, LEARNER_PASSWORD).status_code, 200)
        self.assertEqual(self.client.get("/api/admin/dashboard").status_code, 403)
        self.assertEqual(self.login(ADMIN_EMAIL, ADMIN_PASSWORD).status_code, 200)
        self.assertEqual(self.client.get("/api/admin/dashboard").status_code, 200)

    def test_tc26_writes_without_csrf_header_are_blocked(self):
        """TC26 security: a POST without the X-Requested-With header is rejected (403)."""
        r = self.client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        self.assertEqual(r.status_code, 403)

    def test_tc27_demo_learner_cannot_upload(self):
        """TC27 edge: the shared read-only demo learner gets 'demo_account' when uploading."""
        self.login(LEARNER_EMAIL, LEARNER_PASSWORD)
        eid = self.client.get("/api/portal/overview").get_json()["enrolments"][0]["id"]
        r = self.client.post(f"/api/portal/enrolments/{eid}/uploads", headers=self.H,
                             data={"file": (io.BytesIO(b"hello"), "passport.txt")},
                             content_type="multipart/form-data")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.get_json()["error"]["code"], "demo_account")

    def test_tc28_reminder_reaches_customer_only_after_officer_publishes(self):
        """TC28 human review: AI reminder → draft (customer sees nothing) → officer publishes → customer message."""
        self.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        conn = connect(self.cfg.database_path)
        e = open_enrolment(conn)
        before = scalar(conn, "SELECT COUNT(*) FROM messages WHERE enrolment_id = ?", [e["id"]])
        conn.close()
        r = self.client.post(f"/api/admin/enrolments/{e['id']}/ai/reminder", headers=self.H,
                             json={"tone": "formal", "channel": "portal"})   # no key → labelled template draft
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        draft_id = r.get_json()["draft_id"]
        conn = connect(self.cfg.database_path)
        self.assertEqual(scalar(conn, "SELECT COUNT(*) FROM messages WHERE enrolment_id = ?", [e["id"]]), before)
        conn.close()
        pub = self.client.post(f"/api/admin/drafts/{draft_id}/publish", headers=self.H, json={})
        self.assertEqual(pub.status_code, 200, pub.get_data(as_text=True))
        conn = connect(self.cfg.database_path)
        self.assertEqual(scalar(conn, "SELECT COUNT(*) FROM messages WHERE enrolment_id = ?", [e["id"]]), before + 1)
        self.assertEqual(scalar(conn, "SELECT status FROM reminder_drafts WHERE id = ?", [draft_id]), "published")
        audit = query_one(conn, "SELECT details_json FROM audit_log WHERE action = 'draft.published' "
                                "AND entity_id = ?", [draft_id])
        self.assertIn("message_id", json.loads(audit["details_json"]))
        conn.close()


if __name__ == "__main__":
    unittest.main()
