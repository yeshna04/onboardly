"""Application configuration.

Settings come from environment variables. For local development they can also
be placed in ``backend/.env`` (git-ignored), which is parsed here with a tiny
standard-library loader so no extra package is needed. Real environment
variables always win over values in the file.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


def load_env_file(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE .env file. Ignores blanks and # comments.

    Values already present in ``os.environ`` are not overwritten.
    Returns the pairs that were read (useful for tests).
    """
    loaded: dict[str, str] = {}
    if not path.is_file():
        return loaded
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        elif " #" in value:  # strip trailing inline comment on unquoted values
            value = value.split(" #", 1)[0].rstrip()
        loaded[key] = value
        os.environ.setdefault(key, value)
    return loaded


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Config:
    """All runtime settings in one place (read once at app start)."""

    env: str = "development"
    secret_key: str = ""
    database_path: Path = BACKEND_DIR / "db" / "onboarding.db"
    schema_path: Path = BACKEND_DIR / "db" / "schema.sql"
    upload_dir: Path = BACKEND_DIR / "uploads"
    frontend_dist: Path = PROJECT_DIR / "frontend" / "dist"
    max_upload_mb: int = 5
    allowed_upload_ext: tuple[str, ...] = ("pdf", "jpg", "jpeg", "png", "txt", "csv", "json")

    # LLM – provider is "anthropic" (Claude) or "gemini"
    llm_provider: str = "anthropic"
    gemini_api_key: str = field(default="", repr=False)
    gemini_model: str = "gemini-3.5-flash"
    anthropic_api_key: str = field(default="", repr=False)
    anthropic_model: str = "claude-opus-5-5"
    llm_effort: str = "low"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 2
    llm_max_tokens: int = 8000
    prompt_version: str = "v2"

    # Onboarding: learners who enrol themselves get this many days to send their documents
    default_due_days: int = 21

    # Public-demo protection
    demo_access_code: str = field(default="", repr=False)
    ai_rate_limit_per_minute: int = 20

    # NLP
    nlp_match_threshold: float = 0.35
    nlp_review_threshold: float = 0.60

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def llm_configured(self) -> bool:
        return bool(self.gemini_api_key if self.llm_provider == "gemini" else self.anthropic_api_key)

    @property
    def active_model(self) -> str:
        return self.gemini_model if self.llm_provider == "gemini" else self.anthropic_model

    @property
    def provider_label(self) -> str:
        return "Gemini" if self.llm_provider == "gemini" else "Claude"

    @classmethod
    def from_env(cls, env_file: Path | None = None) -> "Config":
        load_env_file(env_file or BACKEND_DIR / ".env")
        env = os.environ.get("APP_ENV", "development").strip().lower()
        secret = os.environ.get("SECRET_KEY", "")
        if not secret:
            # Fine for local use (sessions reset on restart); production must set it.
            secret = secrets.token_hex(32)
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        gemini_key = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
        provider = os.environ.get("LLM_PROVIDER", "").strip().lower()
        if provider not in ("anthropic", "gemini"):
            # No explicit choice: use whichever key is present (Claude first).
            provider = "gemini" if gemini_key and not anthropic_key else "anthropic"
        return cls(
            env=env,
            llm_provider=provider,
            gemini_api_key=gemini_key,
            gemini_model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash").strip(),
            secret_key=secret,
            database_path=Path(os.environ.get("DATABASE_PATH", BACKEND_DIR / "db" / "onboarding.db")),
            upload_dir=Path(os.environ.get("UPLOAD_DIR", BACKEND_DIR / "uploads")),
            max_upload_mb=_int("MAX_UPLOAD_MB", 5),
            anthropic_api_key=anthropic_key,
            anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5").strip(),
            llm_effort=os.environ.get("LLM_EFFORT", "low").strip().lower(),
            llm_timeout_seconds=_float("LLM_TIMEOUT_SECONDS", 45.0),
            llm_max_retries=_int("LLM_MAX_RETRIES", 2),
            llm_max_tokens=_int("LLM_MAX_TOKENS", 8000),
            prompt_version=os.environ.get("PROMPT_VERSION", "v2").strip(),
            demo_access_code=os.environ.get("DEMO_ACCESS_CODE", "").strip(),
            ai_rate_limit_per_minute=_int("AI_RATE_LIMIT_PER_MINUTE", 20),
            default_due_days=_int("DEFAULT_DUE_DAYS", 21),
            nlp_match_threshold=_float("NLP_MATCH_THRESHOLD", 0.35),
            nlp_review_threshold=_float("NLP_REVIEW_THRESHOLD", 0.60),
        )
