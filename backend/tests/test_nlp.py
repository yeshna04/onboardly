"""NLP pipeline: service detection, document extraction, intent, PII masking and upload classification."""
from __future__ import annotations

import json
import unittest

from app.config import BACKEND_DIR
from app.nlp import pipeline as nlp
from app.nlp.extractors import extract_dates
from app.nlp.preprocess import mask_pii

PROGRAMMES = json.loads((BACKEND_DIR / "data" / "sample" / "programmes.json").read_text())["programmes"]


def programme(code: str) -> dict:
    p = next(p for p in PROGRAMMES if p["code"] == code)
    docs = [{**d, "id": i + 1} for i, d in enumerate(p["documents"])]
    return {**p, "documents": docs}


ALL = [programme(p["code"]) for p in PROGRAMMES]


class NlpPipelineTests(unittest.TestCase):

    def test_tc01_intake_email_extracts_service_documents_and_pending_items(self):
        """TC01 normal: intake email → Study-Abroad Pathway detected; passport/transcript submitted, IELTS pending."""
        text = ("Hi team, I'd like to join the Study-Abroad Pathway for the spring intake. I've attached my "
                "passport scan and my school transcript. My IELTS test is booked so I will send the score next week.")
        result = nlp.analyze_text(text, programme("SAP"), ALL)
        self.assertEqual(result["detected_service"]["code"], "SAP")
        cues = {m["doc_code"]: m["cue"] for m in result["document_matches"]}
        self.assertEqual(cues.get("PASSPORT"), "submitted")
        self.assertEqual(cues.get("TRANSCRIPT"), "submitted")
        self.assertEqual(cues.get("ENGLISH_TEST"), "pending")
        self.assertEqual(result["warnings"], [])

    def test_tc02_empty_input_is_handled_without_errors(self):
        """TC02 edge: whitespace-only text → no matches, a clear warning, no exception."""
        result = nlp.analyze_text("   \n\t  ", programme("SAP"), ALL)
        self.assertEqual(result["document_matches"], [])
        self.assertIn("Text was empty after cleaning.", result["warnings"])
        self.assertIsNone(result["detected_service"]["code"])

    def test_tc03_unsupported_request_is_flagged_for_a_human(self):
        """TC03 edge: a refund request → intent 'unsupported' and a route-to-human warning."""
        result = nlp.analyze_text("I want a refund of my deposit please, cancel everything.", programme("DSB"), ALL)
        self.assertEqual(result["intent"]["label"], "unsupported")
        self.assertTrue(any("Route it to a human" in w for w in result["warnings"]))

    def test_tc04_malformed_text_produces_no_false_matches(self):
        """TC04 edge: random symbols / gibberish → no document matches and no detected service."""
        result = nlp.analyze_text("@@## ~~ qwzx ??? 12345 ////", programme("DSB"), ALL)
        self.assertEqual(result["document_matches"], [])
        self.assertIsNone(result["detected_service"]["code"])

    def test_tc05_personal_data_is_masked(self):
        """TC05 privacy: emails and phone numbers are masked before text is stored or sent to the LLM."""
        masked = mask_pii("Reach me at aria.kestrel@learner.test or +44 7700 900101.")
        self.assertNotIn("aria.kestrel@learner.test", masked)
        self.assertNotIn("7700 900101", masked)

    def test_tc06_upload_is_classified_from_its_file_name(self):
        """TC06 normal: 'passport_scan.pdf' → suggested checklist item PASSPORT."""
        result = nlp.classify_upload("passport_scan.pdf", None, None, programme("SAP")["documents"])
        self.assertEqual(result["best"]["doc_code"], "PASSPORT")

    def test_tc07_dates_are_extracted_in_several_formats(self):
        """TC07 normal: ISO, day-month-year and relative dates are recognised."""
        found = extract_dates("Due 2026-12-13, exam on 5 January 2027, I'll send it next week.")
        isos = {d["iso"] for d in found if d["kind"] == "absolute"}
        self.assertEqual(isos, {"2026-12-13", "2027-01-05"})
        self.assertTrue(any(d["kind"] == "relative" for d in found))


if __name__ == "__main__":
    unittest.main()
