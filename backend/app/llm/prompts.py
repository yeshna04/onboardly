"""Load versioned prompt templates from backend/prompts/<version>/ and the JSON output schemas."""
from __future__ import annotations

import json
from functools import lru_cache
from string import Template

from ..config import BACKEND_DIR
from ..errors import ValidationError

PROMPTS_DIR = BACKEND_DIR / "prompts"
TASKS = ("explain_outstanding", "draft_reminder")

EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "doc_code": {"type": "string"},
                    "owner": {"type": "string", "enum": ["customer", "officer"]},
                    "action": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["doc_code", "owner", "action", "reason"],
                "additionalProperties": False,
            },
        },
        "risk_level": {"type": "string", "enum": ["low", "medium", "high"]},
        "risk_reason": {"type": "string"},
        "officer_next_action": {"type": "string"},
    },
    "required": ["summary", "steps", "risk_level", "risk_reason", "officer_next_action"],
    "additionalProperties": False,
}

REMINDER_SCHEMA = {
    "type": "object",
    "properties": {
        "subject": {"type": "string"},
        "body": {"type": "string"},
        "mentioned_doc_codes": {"type": "array", "items": {"type": "string"}},
        "call_to_action": {"type": "string"},
        "tone": {"type": "string", "enum": ["friendly", "formal"]},
    },
    "required": ["subject", "body", "mentioned_doc_codes", "call_to_action", "tone"],
    "additionalProperties": False,
}

SCHEMAS = {"explain_outstanding": EXPLAIN_SCHEMA, "draft_reminder": REMINDER_SCHEMA}


@lru_cache(maxsize=16)
def _read(version: str, name: str) -> str:
    path = PROMPTS_DIR / version / f"{name}.md"
    if not path.is_file():
        raise ValidationError(f"Prompt '{name}' for version '{version}' is missing.", {"prompt_version": version})
    return path.read_text(encoding="utf-8")


def available_versions() -> list[str]:
    return sorted(p.name for p in PROMPTS_DIR.iterdir() if p.is_dir())


def render(task: str, version: str, **values) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for a task. Values are inserted with string.Template ($name)."""
    if task not in TASKS:
        raise ValidationError(f"Unknown LLM task '{task}'.")
    system = _read(version, "system")
    user = Template(_read(version, task)).safe_substitute(
        {k: v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, indent=2) for k, v in values.items()})
    return system, user
