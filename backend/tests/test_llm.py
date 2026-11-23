"""LLM layer with mocked providers: output validation/grounding, Claude SDK errors, Gemini HTTP errors, prompts."""
from __future__ import annotations

import json
import unittest
from dataclasses import replace
from types import SimpleNamespace

import anthropic

try:                       # anthropic>=2 ships its own HTTP client package
    import httpx2 as httpx
except ImportError:        # pragma: no cover – older SDKs use httpx
    import httpx

from app.llm import fallback, prompts
from app.llm.client import ClaudeClient
from app.llm.gemini_client import GeminiClient
from app.llm.validator import validate_explanation, validate_reminder

from .support import make_config

CONTEXT = {
    "customer_first_name": "Aria", "programme": "Study-Abroad Pathway", "enrolment_ref": "ENR-2026-0001",
    "today": "2026-11-23", "due_date": "2026-12-05", "target_start_date": "2027-01-11",
    "completion_pct": 50.0, "mandatory_total": 2, "mandatory_verified": 1,
    "items": [
        {"doc_code": "PASSPORT", "name": "Passport", "mandatory": True, "state": "verified", "description": "",
         "accepted_formats": "pdf", "rejection_reason": None},
        {"doc_code": "ENGLISH_TEST", "name": "English language test result", "mandatory": True, "state": "missing",
         "description": "IELTS or TOEFL score report", "accepted_formats": "pdf", "rejection_reason": None},
    ],
    "customer_actionable": ["ENGLISH_TEST"], "with_staff": [],
}
GOOD_REMINDER = {
    "subject": "One document left for your Study-Abroad Pathway",
    "body": "Hi Aria,\n\nYour passport is verified. To finish onboarding we still need your English language "
            "test result (IELTS or TOEFL score report). Please upload it in your portal by 5 December 2026.\n\n"
            "Best wishes,\nThe Onboarding Team",
    "mentioned_doc_codes": ["ENGLISH_TEST"], "call_to_action": "Upload your English test result", "tone": "friendly",
}
SCHEMA = prompts.REMINDER_SCHEMA


class ValidatorTests(unittest.TestCase):

    def test_tc12_grounded_reminder_passes_validation(self):
        """TC12 normal: a reminder that only mentions checklist items and the real due date has no errors."""
        errors, warnings = validate_reminder(GOOD_REMINDER, CONTEXT, "email")
        self.assertEqual(errors, [])

    def test_tc13_hallucinated_or_unsafe_reminder_is_rejected(self):
        """TC13 edge: invented document, invented date, a link, a promise and a placeholder are all caught."""
        bad = dict(GOOD_REMINDER,
                   body="Hi Aria, please send your VISA letter by 1 March 2027 at https://example.com. "
                        "You are guaranteed a place. Regards, [Officer Name]",
                   mentioned_doc_codes=["VISA_LETTER"])
        errors, _ = validate_reminder(bad, CONTEXT, "email")
        text = " | ".join(errors)
        for expected in ("not on this checklist", "does not ask for required items", "date not in the checklist",
                         "contains a link", "promise", "placeholder"):
            self.assertIn(expected.lower(), text.lower(), f"missing check: {expected}")

    def test_tc14_explanation_must_cover_open_items_and_not_verified_ones(self):
        """TC14 edge: an explanation that skips the missing item and re-asks for a verified one is rejected."""
        bad = {"summary": "Passport needs checking again.", "risk_level": "extreme", "risk_reason": "n/a",
               "officer_next_action": "Ask again",
               "steps": [{"doc_code": "PASSPORT", "owner": "customer", "action": "Resend", "reason": "x"}]}
        errors, _ = validate_explanation(bad, CONTEXT)
        joined = " ".join(errors)
        self.assertIn("already verified", joined)
        self.assertIn("ENGLISH_TEST", joined)
        self.assertIn("risk_level", joined)
        # the deterministic fallback for the same context always validates
        self.assertEqual(validate_explanation(fallback.explanation(CONTEXT), CONTEXT)[0], [])

    def test_tc15_prompt_pack_renders_versioned_prompts_with_context(self):
        """TC15 normal: v1 and v2 prompts exist, render the checklist JSON and reject unknown tasks/versions."""
        self.assertEqual(prompts.available_versions(), ["v1", "v2"])
        system, user = prompts.render("draft_reminder", "v2", context=CONTEXT, evidence="None",
                                      recent_messages="None", tone="friendly", channel="email")
        self.assertIn("ENGLISH_TEST", user)
        self.assertNotIn("$context", user)
        self.assertTrue(system.strip())
        from app.errors import ValidationError
        with self.assertRaises(ValidationError):
            prompts.render("grade_learner", "v2")
        with self.assertRaises(ValidationError):
            prompts.render("draft_reminder", "v9")


def fake_claude(create):
    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))


class ClaudeClientTests(unittest.TestCase):
    cfg = replace(make_config(), anthropic_api_key="sk-test-not-real", anthropic_model="claude-opus-5-5")

    def test_tc16_claude_success_records_model_usage_and_request_id(self):
        """TC16 normal (mocked API): JSON reply is parsed; model, tokens, stop reason and request id are kept."""
        sent = {}

        def create(**kwargs):
            sent.update(kwargs)
            return SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps(GOOD_REMINDER))],
                                   model="claude-opus-5-5", stop_reason="end_turn", id="msg_01",
                                   usage=SimpleNamespace(input_tokens=812, output_tokens=164, iterations=[]))

        result = ClaudeClient(self.cfg, sdk_client=fake_claude(create)).generate_json(
            system="sys", messages=[{"role": "user", "content": "hi"}], schema=SCHEMA)
        self.assertTrue(result.ok)
        self.assertEqual((result.model, result.input_tokens, result.output_tokens), ("claude-opus-5-5", 812, 164))
        self.assertEqual(result.request_id, "msg_01")
        self.assertEqual(sent["output_config"]["format"]["type"], "json_schema")   # structured output requested

    def test_tc17_claude_timeout_auth_error_and_bad_json_fail_safely(self):
        """TC17 failure (mocked API): timeout, 401 and non-JSON text return error statuses instead of raising."""
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")

        def timeout(**_):
            raise anthropic.APITimeoutError(request=request)

        def unauthorised(**_):
            raise anthropic.AuthenticationError("invalid x-api-key",
                                                response=httpx.Response(401, request=request), body=None)

        def not_json(**_):
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="Sure! Here is your reminder")],
                                   model="claude-opus-5-5", stop_reason="end_turn", id="msg_02",
                                   usage=SimpleNamespace(input_tokens=1, output_tokens=1, iterations=[]))

        call = dict(system="s", messages=[{"role": "user", "content": "x"}], schema=SCHEMA)
        r1 = ClaudeClient(self.cfg, sdk_client=fake_claude(timeout)).generate_json(**call)
        r2 = ClaudeClient(self.cfg, sdk_client=fake_claude(unauthorised)).generate_json(**call)
        r3 = ClaudeClient(self.cfg, sdk_client=fake_claude(not_json)).generate_json(**call)
        self.assertEqual(r1.status, "timeout")
        self.assertEqual(r2.status, "api_error")
        self.assertIn("401", r2.error)
        self.assertEqual(r3.status, "validation_failed")
        self.assertFalse(any(r.ok for r in (r1, r2, r3)))

    def test_tc18_missing_api_key_reports_not_configured(self):
        """TC18 edge: no API key → 'not_configured' without any network call."""
        result = ClaudeClient(make_config()).generate_json(system="s", messages=[], schema=SCHEMA)
        self.assertEqual(result.status, "not_configured")


class GeminiClientTests(unittest.TestCase):
    cfg = replace(make_config(), llm_provider="gemini", gemini_api_key="test-key-not-real",
                  gemini_model="gemini-test", llm_max_retries=1)

    def test_tc19_gemini_retries_a_503_then_succeeds(self):
        """TC19 recovery (mocked HTTP): a 503 is retried once, then the JSON answer and usage are recorded."""
        replies = [(503, {"error": {"message": "overloaded"}}),
                   (200, {"modelVersion": "gemini-test-001", "responseId": "resp_1",
                          "usageMetadata": {"promptTokenCount": 700, "candidatesTokenCount": 120},
                          "candidates": [{"finishReason": "STOP",
                                          "content": {"parts": [{"text": json.dumps(GOOD_REMINDER)}]}}]})]
        client = GeminiClient(self.cfg, transport=lambda url, payload: replies.pop(0))
        client._sleep = lambda attempt: None
        result = client.generate_json(system="s", messages=[{"role": "user", "content": "x"}], schema=SCHEMA)
        self.assertTrue(result.ok, result.error)
        self.assertEqual((result.provider, result.model, result.input_tokens), ("gemini", "gemini-test-001", 700))
        self.assertEqual(result.extra["attempts"], 2)

    def test_tc20_gemini_quota_error_is_reported_not_raised(self):
        """TC20 failure (mocked HTTP): repeated 429 → 'api_error' with a readable quota message."""
        client = GeminiClient(self.cfg, transport=lambda url, payload: (429, {"error": {"message": "quota"}}))
        client._sleep = lambda attempt: None
        result = client.generate_json(system="s", messages=[{"role": "user", "content": "x"}], schema=SCHEMA)
        self.assertEqual(result.status, "api_error")
        self.assertIn("429", result.error)


if __name__ == "__main__":
    unittest.main()
