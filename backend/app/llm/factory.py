"""Pick the LLM client for the configured provider (LLM_PROVIDER = anthropic | gemini)."""
from __future__ import annotations

from ..config import Config
from .client import ClaudeClient
from .gemini_client import GeminiClient


def make_client(cfg: Config):
    return GeminiClient(cfg) if cfg.llm_provider == "gemini" else ClaudeClient(cfg)
