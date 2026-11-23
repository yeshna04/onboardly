"""Checklist comparison, status rules, input validation and the CRM/LMS CSV connector (pandas)."""
from __future__ import annotations

import unittest
from datetime import date

from app.config import BACKEND_DIR
from app.connectors.crm_import import import_customers
from app.db import connect, init_db, scalar
from app.errors import ValidationError
from app.services.checklist import build_checklist, derive_status, next_step
from app.validation import clean_date, clean_email, clean_password

from .support import make_config, _TMP_ROOT

DOCS = [
    {"id": 1, "doc_code": "PASSPORT", "name": "Passport", "is_mandatory": 1},
    {"id": 2, "doc_code": "TRANSCRIPT", "name": "Transcript", "is_mandatory": 1},
    {"id": 3, "doc_code": "ENGLISH_TEST", "name": "English test result", "is_mandatory": 1},
    {"id": 4, "doc_code": "PHOTO", "name": "Photo", "is_mandatory": 0},
]


class ChecklistTests(unittest.TestCase):

    def test_tc08_checklist_compares_required_vs_submitted(self):
        """TC08 normal: verified + rejected + missing items give the right counts, outstanding list and next step."""
        subs = [
            {"id": 10, "required_document_id": 1, "status": "verified", "created_at": "2026-11-01T10:00:00Z"},
            {"id": 11, "required_document_id": 2, "status": "rejected", "rejection_reason": "Blurry scan",
             "created_at": "2026-11-02T10:00:00Z"},
        ]
        cl = build_checklist(DOCS, subs, today=date(2026, 11, 23))
        self.assertEqual(cl["required_count"], 3)
        self.assertEqual(cl["verified_count"], 1)
        self.assertEqual({o["doc_code"]: o["state"] for o in cl["outstanding"]},
                         {"TRANSCRIPT": "rejected", "ENGLISH_TEST": "missing"})
        self.assertFalse(cl["all_collected"])
        step = next_step(cl)
        self.assertEqual(step["title"], "Re-upload your transcript")   # rejected items come first
        self.assertEqual(step["detail"], "Blurry scan")

    def test_tc09_status_follows_checklist_and_old_documents_stay_valid(self):
        """TC09 edge: an old document date never expires an item; full set → ready_for_review; terminal states stay."""
        subs = [{"id": 20, "required_document_id": 3, "status": "verified", "document_date": "2019-01-01",
                 "created_at": "2026-11-01T10:00:00Z"}]
        cl = build_checklist(DOCS, subs, today=date(2026, 11, 23))
        english = next(i for i in cl["items"] if i["doc_code"] == "ENGLISH_TEST")
        self.assertEqual(english["state"], "verified")                       # no validity / expiry rule
        self.assertNotIn("expires_on", english)
        self.assertEqual(derive_status("new", cl, False), "new")              # shown as "Enrolled" in the UI

        all_in = [{"id": 30 + d["id"], "required_document_id": d["id"], "status": "submitted",
                   "created_at": "2026-11-20T10:00:00Z"} for d in DOCS if d["is_mandatory"]]
        cl2 = build_checklist(DOCS, all_in, today=date(2026, 11, 23))
        self.assertEqual(derive_status("awaiting_docs", cl2, True), "ready_for_review")
        self.assertEqual(derive_status("cancelled", cl2, True), "cancelled")   # terminal states never change


class ValidationTests(unittest.TestCase):

    def test_tc10_invalid_inputs_raise_validation_errors(self):
        """TC10 edge: malformed email, weak password and impossible date are rejected with field messages."""
        with self.assertRaises(ValidationError) as e1:
            clean_email("not-an-email")
        self.assertIn("email", e1.exception.details)
        with self.assertRaises(ValidationError):
            clean_password("password")          # no number
        with self.assertRaises(ValidationError):
            clean_password("abc1")              # too short
        with self.assertRaises(ValidationError):
            clean_date("2026-02-30", "due_date")
        self.assertEqual(clean_email("  Aria.Kestrel@Learner.TEST "), "aria.kestrel@learner.test")


class CrmImportTests(unittest.TestCase):

    def test_tc11_crm_export_with_bad_rows_is_partially_imported(self):
        """TC11 edge: CSV with a missing name, bad email, bad phone and duplicates → valid rows imported, bad rows reported."""
        conn = connect(_TMP_ROOT / "crm-test.db")
        init_db(conn, make_config().schema_path)
        report = import_customers(conn, BACKEND_DIR / "data" / "sample" / "crm_export_with_errors.csv",
                                  filename="crm_export_with_errors.csv")
        conn.commit()
        self.assertGreater(report["imported"], 0)
        self.assertGreater(report["rejected"], 0)
        self.assertEqual(report["imported"] + report["rejected"] + report["skipped_existing"], report["total_rows"])
        fields = {e["field"] for e in report["errors"]}
        self.assertTrue({"full_name", "email"} <= fields, fields)
        self.assertEqual(scalar(conn, "SELECT COUNT(*) FROM customers"), report["imported"])
        self.assertEqual(scalar(conn, "SELECT COUNT(*) FROM audit_log WHERE action = 'crm.import'"), 1)
        conn.close()


if __name__ == "__main__":
    unittest.main()
