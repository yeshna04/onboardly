"""Validate and ground LLM output against the real checklist before anyone sees it.

Errors  → the output is not usable (one repair attempt, then template fallback).
Warnings → usable, but shown to the officer during review.
"""
from __future__ import annotations

import re

from ..nlp.extractors import extract_dates
from ..nlp.preprocess import EMAIL_RE, PHONE_RE

PROMISES = re.compile(r"\b(guarantee[sd]?|definitely (?:be )?(?:approved|accepted)|you (?:are|have been) "
                      r"(?:approved|accepted|admitted)|refund|visa (?:is|will be) (?:approved|granted))\b", re.I)
URL_RE = re.compile(r"(https?://|www\.)\S+", re.I)
PLACEHOLDER_RE = re.compile(r"\[[A-Z][A-Za-z _]{2,30}\]|\{[a-z_]{2,30}\}|<[A-Z_ ]{3,30}>")


def _str(data: dict, key: str, errors: list[str], *, min_len: int = 1, max_len: int = 5000) -> str:
    value = data.get(key)
    if not isinstance(value, str) or len(value.strip()) < min_len:
        errors.append(f"'{key}' is missing or too short.")
        return ""
    if len(value) > max_len:
        errors.append(f"'{key}' is longer than {max_len} characters.")
    return value.strip()


def _check_text_safety(text: str, context: dict, errors: list[str]) -> None:
    allowed_dates = {d for d in (context.get("due_date"), context.get("target_start_date"), context.get("today")) if d}
    for d in extract_dates(text):
        if d["kind"] == "absolute" and d["iso"] not in allowed_dates:
            errors.append(f"Mentions a date not in the checklist data: '{d['text']}'.")
    if PROMISES.search(text):
        errors.append(f"Makes a promise the assistant is not allowed to make: '{PROMISES.search(text).group(0)}'.")
    if URL_RE.search(text):
        errors.append("Contains a link; no links were provided in the context.")
    if EMAIL_RE.search(text) or PHONE_RE.search(text):
        errors.append("Contains contact details that were not provided in the context.")
    if PLACEHOLDER_RE.search(text):
        errors.append(f"Contains an unfilled placeholder: '{PLACEHOLDER_RE.search(text).group(0)}'.")


def validate_reminder(data: dict, context: dict, channel: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    subject = _str(data, "subject", errors, min_len=5, max_len=120)
    body = _str(data, "body", errors, min_len=20, max_len=2500)
    _str(data, "call_to_action", errors, min_len=3, max_len=300)
    codes = data.get("mentioned_doc_codes")
    if not isinstance(codes, list) or not all(isinstance(c, str) for c in codes):
        errors.append("'mentioned_doc_codes' must be a list of document codes.")
        codes = []

    actionable = set(context["customer_actionable"])
    known = {i["doc_code"] for i in context["items"]}
    unknown = [c for c in codes if c not in known]
    not_actionable = [c for c in codes if c in known and c not in actionable]
    if unknown:
        errors.append(f"Ungrounded: mentions document codes that are not on this checklist: {unknown}.")
    if not_actionable:
        errors.append(f"Ungrounded: asks for documents the customer does not need to send: {not_actionable}.")
    mandatory_actionable = {i["doc_code"] for i in context["items"] if i["mandatory"] and i["doc_code"] in actionable}
    missing = sorted(mandatory_actionable - set(codes))
    if missing:
        errors.append(f"Incomplete: the reminder does not ask for required items {missing}.")
    names_by_code = {i["doc_code"]: i["name"].lower() for i in context["items"]}
    for c in codes:
        if c in names_by_code and not _name_mentioned(names_by_code[c], body):
            warnings.append(f"The body may not clearly name '{names_by_code[c]}'.")

    _check_text_safety(f"{subject}\n{body}", context, errors)
    if channel == "sms" and len(body) > 480:
        errors.append(f"SMS body is {len(body)} characters; the limit is 480.")
    words = len(body.split())
    if channel != "sms" and words > 300:
        warnings.append(f"The message is long ({words} words).")
    first = context.get("customer_first_name")
    if first and first.lower() not in body.lower():
        warnings.append("The message does not greet the customer by name.")
    return errors, warnings


def _name_mentioned(name: str, body: str) -> bool:
    low = body.lower()
    words = [w for w in re.findall(r"[a-z]{4,}", name) if w not in {"current", "valid", "signed", "highest"}]
    return name in low or any(w in low for w in words)


def validate_explanation(data: dict, context: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    _str(data, "summary", errors, min_len=10, max_len=1500)
    _str(data, "risk_reason", errors, min_len=5, max_len=500)
    _str(data, "officer_next_action", errors, min_len=5, max_len=500)
    if data.get("risk_level") not in ("low", "medium", "high"):
        errors.append("'risk_level' must be low, medium or high.")
    steps = data.get("steps")
    if not isinstance(steps, list):
        errors.append("'steps' must be a list.")
        steps = []
    states = {i["doc_code"]: i["state"] for i in context["items"]}
    for s in steps:
        code = s.get("doc_code") if isinstance(s, dict) else None
        if code not in states:
            errors.append(f"Ungrounded: step refers to unknown document '{code}'.")
            continue
        if states[code] == "verified":
            errors.append(f"Step asks about '{code}', which is already verified.")
        expected_owner = "customer" if code in context["customer_actionable"] else "officer"
        if s.get("owner") != expected_owner:
            warnings.append(f"Owner for {code} looks wrong (expected {expected_owner}).")
    covered = {s.get("doc_code") for s in steps if isinstance(s, dict)}
    open_mandatory = {i["doc_code"] for i in context["items"] if i["mandatory"] and i["state"] != "verified"}
    if open_mandatory - covered:
        errors.append(f"Incomplete: no step for {sorted(open_mandatory - covered)}.")
    _check_text_safety(" ".join(str(data.get(k, "")) for k in ("summary", "risk_reason", "officer_next_action")),
                       context, errors)
    return errors, warnings
