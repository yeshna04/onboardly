"""End-to-end AI workflow for one enrolment:

    read enrolment → compare checklist → NLP evidence → build prompt
    → Claude (structured JSON) → validate & ground (one repair) → template fallback if needed
    → save llm_interactions / reminder_drafts / audit_log

Every step is timed and returned so the UI can show the pipeline and the trace view can
replay it. Nothing is ever sent to a customer here: reminders are saved as *drafts*.
"""
from __future__ import annotations

import sqlite3
import time
from typing import Callable

from ..config import Config
from ..db import insert, scalar, to_json, transaction
from ..errors import ConflictError, UnsupportedRequestError
from ..llm import fallback, prompts
from ..llm.client import LLMResult
from ..llm.factory import make_client
from ..llm.context import build_context, customer_evidence, recent_messages
from ..llm.validator import validate_explanation, validate_reminder
from ..nlp import pipeline as nlp
from ..repo import audit
from ..repo import enrolments as enrol_repo
from ..repo import programmes as prog_repo
from . import checklist, documents

TASK_LABELS = {"explain_outstanding": "Explain outstanding steps", "draft_reminder": "Draft reminder"}


class StepTimer:
    def __init__(self):
        self.steps: list[dict] = []

    def run(self, name: str, label: str, fn: Callable, *, detail: Callable | None = None):
        started = time.perf_counter()
        try:
            value = fn()
        except Exception as exc:
            self.steps.append({"name": name, "label": label, "status": "error", "detail": str(exc)[:200],
                               "ms": int((time.perf_counter() - started) * 1000)})
            raise
        self.steps.append({"name": name, "label": label, "status": "ok",
                           "detail": detail(value) if detail else None,
                           "ms": int((time.perf_counter() - started) * 1000)})
        return value

    def add(self, name: str, label: str, status: str, detail: str | None, ms: int = 0) -> None:
        self.steps.append({"name": name, "label": label, "status": status, "detail": detail, "ms": ms})


def _validate(task: str, data: dict, context: dict, channel: str) -> tuple[list[str], list[str]]:
    if task == "draft_reminder":
        return validate_reminder(data, context, channel)
    return validate_explanation(data, context)


def run_ai_task(conn: sqlite3.Connection, cfg: Config, *, enrolment_id: int, task: str, actor: dict,
                tone: str = "friendly", channel: str = "portal", client=None) -> dict:
    timer = StepTimer()
    client = client or make_client(cfg)

    # 1. read enrolment
    enrolment = timer.run("read_enrolment", "Read enrolment", lambda: enrol_repo.get(conn, enrolment_id),
                          detail=lambda e: f"{e['enrolment_ref']} · {e['programme_name']} · {e['status']}")
    if enrolment["status"] == "cancelled":
        raise ConflictError("This enrolment is cancelled.")
    if task == "draft_reminder" and enrolment["status"] == "completed":
        raise UnsupportedRequestError("Onboarding is already complete – no reminder is needed.")

    # 2. compare checklist (writes a snapshot, so commit before the slow network call)
    with transaction(conn):
        cl = timer.run("compare_checklist", "Compare checklist",
                       lambda: checklist.run_check(conn, enrolment_id, actor=actor, reason=f"ai_{task}"),
                       detail=lambda c: f"{c['collected_count']}/{c['required_count']} collected · "
                                        f"{len(c['outstanding'])} outstanding")
        enrolment = enrol_repo.get(conn, enrolment_id)

        # 3. NLP evidence – make sure the intake email has been analysed at least once
        def nlp_step():
            has = scalar(conn, "SELECT COUNT(*) FROM nlp_extractions WHERE enrolment_id = ? "
                               "AND source_type = 'intake_text'", [enrolment_id])
            if not has and enrolment.get("intake_text"):
                programme = prog_repo.get(conn, enrolment["programme_id"])
                analysis = nlp.analyze_text(enrolment["intake_text"], programme, prog_repo.list_programmes(conn))
                documents.record_extraction(conn, enrolment_id=enrolment_id, submission_id=None,
                                            source_type="intake_text", original=enrolment["intake_text"],
                                            analysis=analysis)
            return customer_evidence(conn, enrolment_id), recent_messages(conn, enrolment_id)

        evidence, recent = timer.run("nlp_evidence", "NLP evidence", nlp_step,
                                     detail=lambda r: f"{len(r[0])} customer quote(s) · {len(r[1])} recent message(s)")

    context = build_context(conn, enrolment, cl)
    if task == "draft_reminder" and not context["customer_actionable"]:
        raise UnsupportedRequestError("Nothing is waiting on the customer – there is nothing to remind them about.",
                                      {"with_staff": context["with_staff"]})

    # 4. build prompt
    system, user = timer.run(
        "build_prompt", "Build prompt",
        lambda: prompts.render(task, cfg.prompt_version, context=context, evidence=evidence or "None",
                               recent_messages=recent or "None", tone=tone, channel=channel),
        detail=lambda p: f"prompt {cfg.prompt_version} · {len(p[1])} chars")
    messages = [{"role": "user", "content": user}]
    schema = prompts.SCHEMAS[task]

    # 5. call Claude
    started = time.perf_counter()
    result: LLMResult = client.generate_json(system=system, messages=messages, schema=schema)
    attempts = 1 if result.status != "not_configured" else 0
    timer.add("llm_call", f"{cfg.provider_label} API", "ok" if result.status == "success" else "error",
              result.error or f"{result.model} · {result.input_tokens}→{result.output_tokens} tokens",
              int((time.perf_counter() - started) * 1000))

    # 6. validate + ground (one repair attempt)
    errors: list[str] = []
    warnings: list[str] = []
    if result.ok:
        errors, warnings = _validate(task, result.data, context, channel)
        if errors:
            repair = messages + [
                {"role": "assistant", "content": result.raw_text or ""},
                {"role": "user", "content": "Your JSON failed these checks:\n- " + "\n- ".join(errors) +
                 "\nReturn corrected JSON only, using only facts from <onboarding_context>."},
            ]
            second = client.generate_json(system=system, messages=repair, schema=schema)
            attempts += 1
            if second.ok:
                e2, w2 = _validate(task, second.data, context, channel)
                second.input_tokens = (result.input_tokens or 0) + (second.input_tokens or 0)
                second.output_tokens = (result.output_tokens or 0) + (second.output_tokens or 0)
                second.latency_ms += result.latency_ms
                result, errors, warnings = second, e2, w2
            else:
                result.status, result.error = second.status, second.error
        if errors:
            result.status = "validation_failed"
    timer.add("validate", "Validate & ground", "ok" if result.ok and not errors else "error",
              "; ".join(errors[:2]) if errors else (f"passed · {len(warnings)} warning(s)" if result.ok else
                                                    "skipped – no AI output"))

    used_fallback = not (result.ok and not errors)
    output = result.data if not used_fallback else (
        fallback.reminder(context, tone, channel) if task == "draft_reminder" else fallback.explanation(context))
    if used_fallback:
        timer.add("fallback", "Template fallback", "ok", "Grounded template used – clearly labelled as not AI")

    # 7. save
    with transaction(conn):
        def save():
            interaction_id = insert(conn, "llm_interactions", {
                "enrolment_id": enrolment_id, "check_id": cl["check_id"], "task": task,
                "provider": result.provider if attempts else "template",
                "model": result.model, "prompt_version": cfg.prompt_version,
                "request_json": to_json({"provider": cfg.llm_provider, "model": cfg.active_model, "effort": cfg.llm_effort,
                                         "prompt_version": cfg.prompt_version, "tone": tone, "channel": channel,
                                         "system": system, "user": user, "schema": task}),
                "response_text": result.raw_text,
                "parsed_json": to_json(output),
                "input_tokens": result.input_tokens, "output_tokens": result.output_tokens,
                "latency_ms": result.latency_ms, "request_id": result.request_id,
                "stop_reason": result.stop_reason, "attempts": max(attempts, 1),
                "status": "success" if not used_fallback else (
                    "fallback" if result.status == "success" else result.status),
                "error_message": result.error,
                "validation_errors_json": to_json({"errors": errors, "warnings": warnings}),
                "created_by": actor["id"],
            })
            draft_id = None
            if task == "draft_reminder":
                draft_id = insert(conn, "reminder_drafts", {
                    "enrolment_id": enrolment_id, "llm_interaction_id": interaction_id, "channel": channel,
                    "tone": tone, "subject": output["subject"].strip(), "body": output["body"].strip(),
                    "original_body": output["body"].strip(), "is_fallback": int(used_fallback),
                    "created_by": actor["id"],
                })
            audit.record(conn, action=f"ai.{task}", entity_type="llm_interaction", entity_id=interaction_id,
                         enrolment_id=enrolment_id, actor=actor,
                         details={"model": result.model, "status": result.status, "fallback": used_fallback,
                                  "draft_id": draft_id, "errors": errors[:3]})
            return interaction_id, draft_id

        interaction_id, draft_id = timer.run("save", "Save to database", save,
                                             detail=lambda r: f"llm_interactions #{r[0]}" +
                                                              (f" · reminder_drafts #{r[1]}" if r[1] else ""))

    return {
        "task": task,
        "output": output,
        "is_fallback": used_fallback,
        "steps": timer.steps,
        "validation": {"errors": errors, "warnings": warnings},
        "interaction": {"id": interaction_id, "provider": result.provider if attempts else "template",
                        "model": result.model, "status": result.status, "error": result.error,
                        "input_tokens": result.input_tokens, "output_tokens": result.output_tokens,
                        "latency_ms": result.latency_ms, "attempts": attempts, "request_id": result.request_id,
                        "prompt_version": cfg.prompt_version, "served_by_fallback_model": result.served_by_fallback},
        "draft_id": draft_id,
        "context": context,
    }
