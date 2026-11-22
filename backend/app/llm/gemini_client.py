"""Google Gemini client using the public REST API and Python's standard library (urllib).

No extra package is needed. Behaviour mirrors ``ClaudeClient``:
* structured output – ``responseMimeType: application/json`` + ``responseSchema``
* timeout per request, automatic retries with exponential backoff on 429 / 5xx / network errors
* returns an ``LLMResult`` with provider/model/usage/latency metadata for the audit table

The API key is sent in the ``x-goog-api-key`` header (never in the URL, so it can't leak into logs).
"""
from __future__ import annotations

import json
import logging
import random
import socket
import ssl
import time
import urllib.error
import urllib.request
from typing import Callable

from ..config import Config
from .client import LLMResult

log = logging.getLogger(__name__)
API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
RETRYABLE = {429, 500, 502, 503, 504}


def ssl_context() -> ssl.SSLContext:
    """Verified TLS context. Prefers certifi's CA bundle, because python.org builds on macOS ship
    without root certificates and fail with CERTIFICATE_VERIFY_FAILED; falls back to the system store."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover
        return ssl.create_default_context()


def to_gemini_schema(schema: dict) -> dict:
    """Convert our JSON Schema to Gemini's OpenAPI-style schema (upper-case types, no additionalProperties)."""
    out: dict = {}
    for key, value in schema.items():
        if key == "additionalProperties":
            continue
        if key == "type":
            out["type"] = str(value).upper()
        elif key == "properties":
            out["properties"] = {k: to_gemini_schema(v) for k, v in value.items()}
            out["propertyOrdering"] = list(value)
        elif key == "items":
            out["items"] = to_gemini_schema(value)
        else:
            out[key] = value
    return out


class GeminiClient:
    provider = "gemini"

    def __init__(self, cfg: Config, transport: Callable | None = None):
        self.cfg = cfg
        self._transport = transport or self._http   # injectable for tests

    @property
    def configured(self) -> bool:
        return bool(self.cfg.gemini_api_key) or self._transport is not self._http

    # ---------------------------------------------------------------- HTTP
    def _http(self, url: str, payload: dict) -> tuple[int, dict]:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json",
                                              "x-goog-api-key": self.cfg.gemini_api_key})
        try:
            with urllib.request.urlopen(req, timeout=self.cfg.llm_timeout_seconds, context=ssl_context()) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            try:
                body = json.loads(exc.read().decode("utf-8") or "{}")
            except ValueError:
                body = {}
            return exc.code, body

    # ---------------------------------------------------------------- public
    def generate_json(self, *, system: str, messages: list[dict], schema: dict) -> LLMResult:
        model = self.cfg.gemini_model
        if not self.configured:
            return LLMResult(status="not_configured", provider=self.provider, model=model,
                             error="GEMINI_API_KEY is not set – using the template fallback.")
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                         for m in messages],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": to_gemini_schema(schema),
                "temperature": 0.2,
                "maxOutputTokens": self.cfg.llm_max_tokens,
            },
        }
        url = f"{API_ROOT}/models/{model}:generateContent"
        started = time.perf_counter()
        attempt = 0
        while True:
            attempt += 1
            try:
                status, body = self._transport(url, payload)
            except (TimeoutError, socket.timeout):
                if attempt <= self.cfg.llm_max_retries:
                    self._sleep(attempt)
                    continue
                return self._fail("timeout", f"Gemini did not answer within {self.cfg.llm_timeout_seconds:.0f}s.", started)
            except (urllib.error.URLError, OSError) as exc:
                if attempt <= self.cfg.llm_max_retries:
                    self._sleep(attempt)
                    continue
                return self._fail("api_error", f"Could not reach the Gemini API (network error: {exc}).", started)

            if status == 200:
                break
            message = (body.get("error") or {}).get("message", "")[:300]
            if status in RETRYABLE and attempt <= self.cfg.llm_max_retries:
                self._sleep(attempt)
                continue
            friendly = {
                400: f"Gemini rejected the request (400): {message}",
                401: "The Gemini API key was rejected (401). Check GEMINI_API_KEY.",
                403: f"The Gemini API key has no access (403): {message}",
                404: f"Gemini model '{model}' is not available (404): {message} – set GEMINI_MODEL in .env.",
                429: "Gemini rate limit or free-tier quota reached (429) after retries. Try again shortly.",
            }.get(status, f"Gemini API error ({status}) after retries: {message}")
            return self._fail("api_error", friendly, started)

        latency = int((time.perf_counter() - started) * 1000)
        usage = body.get("usageMetadata") or {}
        result = LLMResult(status="success", provider=self.provider, model=body.get("modelVersion") or model,
                           request_id=body.get("responseId"), latency_ms=latency,
                           input_tokens=usage.get("promptTokenCount"),
                           output_tokens=(usage.get("candidatesTokenCount") or 0) + (usage.get("thoughtsTokenCount") or 0),
                           extra={"attempts": attempt})
        block = (body.get("promptFeedback") or {}).get("blockReason")
        candidates = body.get("candidates") or []
        if block or not candidates:
            result.status, result.error = "validation_failed", f"Gemini returned no answer ({block or 'no candidates'})."
            return result
        cand = candidates[0]
        result.stop_reason = cand.get("finishReason")
        result.raw_text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", [])
                                  if not p.get("thought"))
        if result.stop_reason in ("SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"):
            result.status, result.error = "validation_failed", f"Gemini declined to answer ({result.stop_reason})."
            return result
        if result.stop_reason == "MAX_TOKENS":
            result.status, result.error = "validation_failed", "The response was cut off (MAX_TOKENS)."
            return result
        try:
            parsed = json.loads(result.raw_text)
            if not isinstance(parsed, dict):
                raise ValueError("top-level JSON is not an object")
            result.data = parsed
        except ValueError as exc:
            result.status, result.error = "validation_failed", f"Response was not valid JSON: {exc}"[:300]
        return result

    def _sleep(self, attempt: int) -> None:
        time.sleep(min(8.0, 0.8 * 2 ** (attempt - 1)) + random.uniform(0, 0.3))

    def _fail(self, status: str, message: str, started: float) -> LLMResult:
        log.warning("Gemini call failed: %s", message)
        return LLMResult(status=status, provider=self.provider, model=self.cfg.gemini_model, error=message,
                         latency_ms=int((time.perf_counter() - started) * 1000))
