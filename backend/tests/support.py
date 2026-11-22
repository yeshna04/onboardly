"""Shared test helpers: an isolated config, a seeded throw-away database and a scripted (mock) LLM.

Tests never touch backend/db/onboarding.db, backend/.env or a real LLM API.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import replace
from pathlib import Path

from app.config import BACKEND_DIR, Config
from app.llm.client import LLMResult

ADMIN_EMAIL = "officer@tests.test"
ADMIN_PASSWORD = "TestOfficer2026"
LEARNER_EMAIL = "aria.kestrel@learner.test"     # seeded demo learner (read-only)
LEARNER_PASSWORD = "LearnerDemo2026"

_TEMPLATE_DB: Path | None = None
_TMP_ROOT = Path(tempfile.mkdtemp(prefix="onboarding-tests-"))


def make_config(db_path: Path | None = None) -> Config:
    """A config that cannot reach any real API (no keys) and writes only to a temp folder."""
    return Config(
        env="testing",
        secret_key="test-secret",
        database_path=db_path or _TMP_ROOT / "unused.db",
        schema_path=BACKEND_DIR / "db" / "schema.sql",
        upload_dir=_TMP_ROOT / "uploads",
        frontend_dist=_TMP_ROOT / "no-dist",
        llm_provider="anthropic",
        anthropic_api_key="",
        gemini_api_key="",
        llm_max_retries=0,
        ai_rate_limit_per_minute=1000,
        demo_access_code="",
    )


def seeded_db() -> Path:
    """Copy of a freshly seeded synthetic database (seeded once per test run, then copied)."""
    global _TEMPLATE_DB
    if _TEMPLATE_DB is None:
        os.environ["ADMIN_EMAIL"] = ADMIN_EMAIL
        os.environ["ADMIN_PASSWORD"] = ADMIN_PASSWORD
        import seed  # backend/seed.py
        seed._ADMIN = None
        template = _TMP_ROOT / "template.db"
        seed.seed(make_config(template))
        _TEMPLATE_DB = template
    copy = Path(tempfile.mkstemp(suffix=".db", dir=_TMP_ROOT)[1])
    shutil.copyfile(_TEMPLATE_DB, copy)
    return copy


class ScriptedLLM:
    """Mock LLM client: returns the queued LLMResults in order and records every call."""

    provider = "anthropic"

    def __init__(self, *results: LLMResult):
        self.results = list(results)
        self.calls: list[dict] = []

    @property
    def configured(self) -> bool:
        return True

    def generate_json(self, *, system: str, messages: list[dict], schema: dict) -> LLMResult:
        self.calls.append({"system": system, "messages": messages, "schema": schema})
        if not self.results:
            raise AssertionError("ScriptedLLM was called more times than expected")
        return replace(self.results.pop(0))


def ok(data: dict, model: str = "claude-opus-5-5") -> LLMResult:
    import json
    return LLMResult(status="success", provider="anthropic", model=model, data=data, raw_text=json.dumps(data),
                     request_id="req_test_123", stop_reason="end_turn", input_tokens=900, output_tokens=150,
                     latency_ms=1200)
