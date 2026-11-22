"""Claude API client wrapper (official ``anthropic`` SDK).

* Structured output: ``output_config.format`` with a JSON schema, so the reply is JSON.
* Reliability: SDK timeout + automatic retries (429/5xx/connection), typed error handling.
* Safety net: Anthropic's server-side refusal fallback (``fallbacks="default"``) is enabled.
* Every call returns an ``LLMResult`` with provider/model/usage/latency metadata for the audit table.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import anthropic

from ..config import Config

log = logging.getLogger(__name__)
FALLBACK_BETA = "server-side-fallback-2026-07-01"


@dataclass
class LLMResult:
    status: str                      # success | api_error | timeout | not_configured | validation_failed
    provider: str = "anthropic"
    model: str | None = None
    data: dict | None = None
    raw_text: str | None = None
    request_id: str | None = None
    stop_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int = 0
    error: str | None = None
    served_by_fallback: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "success" and self.data is not None

    def to_dict(self) -> dict:
        return asdict(self)


class ClaudeClient:
    provider = "anthropic"

    def __init__(self, cfg: Config, sdk_client: Any | None = None):
        self.cfg = cfg
        self._client = sdk_client   # injectable for tests

    @property
    def configured(self) -> bool:
        return self._client is not None or self.cfg.llm_configured

    def _sdk(self):
        if self._client is None:
            self._client = anthropic.Anthropic(api_key=self.cfg.anthropic_api_key,
                                               timeout=self.cfg.llm_timeout_seconds,
                                               max_retries=self.cfg.llm_max_retries)
        return self._client

    def generate_json(self, *, system: str, messages: list[dict], schema: dict) -> LLMResult:
        if not self.configured:
            return LLMResult(status="not_configured", model=self.cfg.anthropic_model,
                             error="ANTHROPIC_API_KEY is not set – using the template fallback.")
        started = time.perf_counter()
        try:
            response = self._sdk().beta.messages.create(
                model=self.cfg.anthropic_model,
                max_tokens=self.cfg.llm_max_tokens,
                system=system,
                messages=messages,
                output_config={"effort": self.cfg.llm_effort,
                               "format": {"type": "json_schema", "schema": schema}},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except anthropic.APITimeoutError:
            return self._fail("timeout", f"Claude did not answer within {self.cfg.llm_timeout_seconds:.0f}s.", started)
        except anthropic.AuthenticationError:
            return self._fail("api_error", "The Claude API key was rejected (401). Check ANTHROPIC_API_KEY.", started)
        except anthropic.PermissionDeniedError:
            return self._fail("api_error", "The API key has no access to this model (403).", started)
        except anthropic.NotFoundError:
            return self._fail("api_error", f"Model '{self.cfg.anthropic_model}' was not found (404).", started)
        except anthropic.RateLimitError:
            return self._fail("api_error", "Claude rate limit reached (429) after retries. Try again shortly.", started)
        except anthropic.BadRequestError as exc:
            return self._fail("api_error", f"Claude rejected the request (400): {exc.message}"[:400], started)
        except anthropic.APIStatusError as exc:
            return self._fail("api_error", f"Claude API error ({exc.status_code}) after retries.", started)
        except anthropic.APIConnectionError:
            return self._fail("api_error", "Could not reach the Claude API (network error).", started)

        latency = int((time.perf_counter() - started) * 1000)
        text = "".join(b.text for b in response.content if getattr(b, "type", None) == "text")
        usage = getattr(response, "usage", None)
        iterations = getattr(usage, "iterations", None) or []
        result = LLMResult(
            status="success", model=getattr(response, "model", self.cfg.anthropic_model), raw_text=text,
            request_id=getattr(response, "_request_id", None) or getattr(response, "id", None),
            stop_reason=getattr(response, "stop_reason", None),
            input_tokens=getattr(usage, "input_tokens", None), output_tokens=getattr(usage, "output_tokens", None),
            latency_ms=latency,
            served_by_fallback=any(getattr(i, "type", None) == "fallback_message" for i in iterations),
        )
        if result.stop_reason == "refusal":
            result.status, result.error = "validation_failed", "Claude declined to answer this request."
            return result
        if result.stop_reason == "max_tokens":
            result.status, result.error = "validation_failed", "The response was cut off (max_tokens)."
            return result
        try:
            parsed = json.loads(text)
            if not isinstance(parsed, dict):
                raise ValueError("top-level JSON is not an object")
            result.data = parsed
        except ValueError as exc:
            result.status, result.error = "validation_failed", f"Response was not valid JSON: {exc}"[:300]
        return result

    def _fail(self, status: str, message: str, started: float) -> LLMResult:
        log.warning("LLM call failed: %s", message)
        return LLMResult(status=status, model=self.cfg.anthropic_model, error=message,
                         latency_ms=int((time.perf_counter() - started) * 1000))
