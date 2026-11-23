"""Admin portal API (onboarding officers). Every route requires role=admin."""
from __future__ import annotations

import difflib
from datetime import date

from flask import Blueprint, Response, g, jsonify, request, send_file

from ..connectors.crm_import import import_customers
from ..db import from_json, get_db, query_all, transaction, utcnow
from ..errors import ConflictError, NotFoundError, ValidationError
from ..repo import audit
from ..repo import customers as cust_repo
from ..repo import enrolments as enrol_repo
from ..repo import messages as msg_repo
from ..repo import programmes as prog_repo
from ..repo import submissions as sub_repo
from ..repo import users as users_repo
from ..security import admin_required, ai_limiter, require_demo_code
from ..nlp import pipeline as nlp
from ..services import ai_workflow, analytics, checklist, documents
from ..validation import (Validator, clean_bool, clean_code, clean_date, clean_email, clean_enum, clean_id, clean_int,
                          clean_keywords, clean_name, clean_phone, clean_str, clean_text_block)
from ._common import audit_event, body, cfg, int_arg

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@bp.before_request
@admin_required
def _guard():
    """All admin endpoints require an admin session."""


# ------------------------------------------------------------------ dashboard
@bp.get("/dashboard")
def dashboard():
    return jsonify(analytics.dashboard_stats(get_db()))


@bp.get("/reports/onboarding.csv")
def report_csv():
    df = analytics.onboarding_report(get_db())
    return Response(df.to_csv(index=False), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=onboarding_report.csv"})


# ------------------------------------------------------------------ customers
@bp.get("/customers")
def customers_list():
    return jsonify({"items": cust_repo.search(get_db(), request.args.get("q", "").strip() or None,
                                              int_arg("limit", 50))})


@bp.get("/customers/<int:customer_id>")
def customer_detail(customer_id: int):
    conn = get_db()
    customer = cust_repo.get(conn, customer_id)
    customer["enrolments"] = enrol_repo.list_enrolments(conn, customer_id=customer_id)
    customer["has_login"] = users_repo.get_by_customer(conn, customer_id) is not None
    return jsonify({"customer": customer})


def _customer_fields(payload: dict, partial: bool = False) -> dict:
    v = Validator(payload)
    values = {}
    if not partial or "full_name" in payload:
        values["full_name"] = v.field("full_name", clean_name)
    if not partial or "email" in payload:
        values["email"] = v.field("email", clean_email)
    if "phone" in payload or not partial:
        values["phone"] = v.field("phone", clean_phone)
    if "country" in payload or not partial:
        values["country"] = v.field("country", clean_str, required=False, max_len=60)
    if partial and "status" in payload:
        values["status"] = v.field("status", clean_enum, ("active", "inactive"))
    v.raise_if_errors()
    return values


@bp.post("/customers")
def customer_create():
    values = _customer_fields(body())
    conn = get_db()
    with transaction(conn):
        cid = cust_repo.create(conn, **values, source="admin")
        audit_event(conn, "customer.created", "customer", cid, details=values)
    return jsonify({"customer": cust_repo.get(conn, cid)}), 201


@bp.patch("/customers/<int:customer_id>")
def customer_update(customer_id: int):
    values = _customer_fields(body(), partial=True)
    conn = get_db()
    before = cust_repo.get(conn, customer_id)
    with transaction(conn):
        cust_repo.update_customer(conn, customer_id, values)
        audit_event(conn, "customer.updated", "customer", customer_id,
                    details={"before": {k: before[k] for k in values}, "after": values})
    return jsonify({"customer": cust_repo.get(conn, customer_id)})


@bp.post("/import/crm")
def crm_import():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        raise ValidationError("Choose a CSV or JSON export to import.", {"file": "No file uploaded."})
    if not upload.filename.lower().endswith((".csv", ".json")):
        raise ValidationError("Only .csv or .json exports are supported.", {"file": "Unsupported file type."})
    conn = get_db()
    with transaction(conn):
        report = import_customers(conn, upload.stream, filename=upload.filename, actor=g.user)
    return jsonify({"report": report})


# ------------------------------------------------------------------ programmes
@bp.get("/programmes")
def programmes_list():
    return jsonify({"items": prog_repo.list_programmes(get_db(), include_inactive=True)})


def _programme_fields(payload: dict, partial: bool = False) -> dict:
    v = Validator(payload)
    out = {}
    spec = {
        "code": (clean_code, (), {}),
        "name": (clean_str, (), {"min_len": 3, "max_len": 80}),
        "description": (clean_text_block, (), {"min_len": 10, "max_len": 1000}),
        "category": (clean_str, (), {"max_len": 40}),
        "duration_weeks": (clean_int, (), {"min_value": 1, "max_value": 104}),
        "keywords": (clean_keywords, (), {}),
        "is_active": (clean_bool, (), {"default": True}),
    }
    for key, (fn, args, kwargs) in spec.items():
        if partial and key not in payload:
            continue
        out[key] = v.field(key, fn, *args, **kwargs)
    v.raise_if_errors()
    if "is_active" in out:
        out["is_active"] = int(out["is_active"])
    return out


@bp.post("/programmes")
def programme_create():
    """Create a programme together with its checklist documents, all-or-nothing.

    Body: programme fields + ``documents: [ {doc_code, name, description, ...}, ... ]``.
    At least one mandatory document is required so every programme has a usable checklist.
    Field errors for documents are reported as ``documents.<index>.<field>``.
    """
    payload = body()
    values = _programme_fields(payload)
    raw_docs = payload.get("documents")
    if not isinstance(raw_docs, list) or not raw_docs:
        raise ValidationError("Add at least one required document to the checklist.",
                              {"documents": "Add at least one document."})
    if len(raw_docs) > 30:
        raise ValidationError("Too many documents.", {"documents": "Use at most 30 documents per programme."})
    docs, errors, seen = [], {}, {}
    for i, raw in enumerate(raw_docs):
        try:
            doc = _document_fields(raw if isinstance(raw, dict) else {})
        except ValidationError as exc:
            for field, msg in (exc.details or {}).items():
                errors[f"documents.{i}.{field}"] = msg
            continue
        if doc["doc_code"] in seen:
            errors[f"documents.{i}.doc_code"] = f"Same code as document {seen[doc['doc_code']] + 1}."
        seen.setdefault(doc["doc_code"], i)
        docs.append(doc)
    if not errors and not any(d.get("is_mandatory", 1) for d in docs):
        errors["documents"] = "At least one document must be mandatory."
    if errors:
        first = next(iter(errors.values()))
        raise ValidationError(f"Please fix the highlighted fields. {first}", errors)
    conn = get_db()
    with transaction(conn):
        pid = prog_repo.create(conn, values)
        for order, doc in enumerate(docs, start=1):
            prog_repo.add_document(conn, pid, {**doc, "sort_order": order})
        audit_event(conn, "programme.created", "programme", pid,
                    details={**values, "documents": [d["doc_code"] for d in docs]})
    return jsonify({"programme": prog_repo.get(conn, pid)}), 201


@bp.patch("/programmes/<int:programme_id>")
def programme_update(programme_id: int):
    values = _programme_fields(body(), partial=True)
    conn = get_db()
    with transaction(conn):
        prog_repo.update_programme(conn, programme_id, values)
        audit_event(conn, "programme.updated", "programme", programme_id, details=values)
    return jsonify({"programme": prog_repo.get(conn, programme_id)})


def _document_fields(payload: dict, partial: bool = False) -> dict:
    v = Validator(payload)
    out = {}
    spec = {
        "doc_code": (clean_code, {}),
        "name": (clean_str, {"min_len": 3, "max_len": 80}),
        "description": (clean_text_block, {"min_len": 5, "max_len": 500}),
        "why_needed": (clean_text_block, {"required": False, "max_len": 500}),
        "accepted_formats": (clean_keywords, {}),
        "keywords": (clean_keywords, {}),
        "is_mandatory": (clean_bool, {"default": True}),
    }
    for key, (fn, kwargs) in spec.items():
        if partial and key not in payload:
            continue
        out[key] = v.field(key, fn, **kwargs)
    v.raise_if_errors()
    if "is_mandatory" in out:
        out["is_mandatory"] = int(out["is_mandatory"])
    if "accepted_formats" in out:
        out["accepted_formats"] = (out["accepted_formats"] or "pdf, jpg, png").replace(" ", "")
    if "why_needed" in out and out["why_needed"] is None:
        out["why_needed"] = ""
    return out


@bp.post("/programmes/<int:programme_id>/documents")
def document_create(programme_id: int):
    values = _document_fields(body())
    conn = get_db()
    with transaction(conn):
        doc_id = prog_repo.add_document(conn, programme_id, values)
        audit_event(conn, "required_document.created", "required_document", doc_id, details=values)
    return jsonify({"document": prog_repo.get_document(conn, doc_id)}), 201


@bp.patch("/documents/<int:doc_id>")
def document_update(doc_id: int):
    values = _document_fields(body(), partial=True)
    conn = get_db()
    with transaction(conn):
        prog_repo.update_document(conn, doc_id, values)
        audit_event(conn, "required_document.updated", "required_document", doc_id, details=values)
    return jsonify({"document": prog_repo.get_document(conn, doc_id)})


@bp.delete("/documents/<int:doc_id>")
def document_delete(doc_id: int):
    conn = get_db()
    doc = prog_repo.get_document(conn, doc_id)
    with transaction(conn):
        prog_repo.delete_document(conn, doc_id)
        audit_event(conn, "required_document.deleted", "required_document", doc_id,
                    details={"doc_code": doc["doc_code"], "programme_id": doc["programme_id"]})
    return jsonify({"ok": True})


# ------------------------------------------------------------------ enrolments
@bp.get("/enrolments")
def enrolments_list():
    status = request.args.get("status") or None
    if status and status not in enrol_repo.STATUSES:
        raise ValidationError("Unknown status filter.", {"status": f"Use one of {', '.join(enrol_repo.STATUSES)}."})
    programme_id = request.args.get("programme_id")
    items = enrol_repo.list_enrolments(get_db(), status=status,
                                       programme_id=clean_id(programme_id, "programme_id") if programme_id else None,
                                       search=request.args.get("q", "").strip() or None, limit=int_arg("limit", 200))
    return jsonify({"items": items})


@bp.post("/enrolments")
def enrolment_create():
    """Create an enrolment for an existing customer (customer_id) or a new one (customer{...})."""
    payload = body()
    v = Validator(payload)
    programme_id = v.field("programme_id", clean_id)
    intake_text = v.field("intake_text", clean_text_block, required=False, label="Intake note")
    due_date = v.field("due_date", clean_date)
    target_start = v.field("target_start_date", clean_date)
    send_invite = v.field("send_invite", clean_bool, default=True)
    customer_id = payload.get("customer_id")
    if customer_id is None and not isinstance(payload.get("customer"), dict):
        v.errors["customer_id"] = "Choose a customer or enter new customer details."
    v.raise_if_errors()

    conn = get_db()
    programme = prog_repo.get(conn, programme_id)
    if not programme["is_active"]:
        raise ValidationError("That programme is not open for enrolment.", {"programme_id": "Inactive programme."})
    with transaction(conn):
        if customer_id is not None:
            customer = cust_repo.get(conn, clean_id(customer_id, "customer_id"))
        else:
            values = _customer_fields(payload["customer"])
            customer = cust_repo.get(conn, cust_repo.create(conn, **values, source="admin"))
            audit_event(conn, "customer.created", "customer", customer["id"], details=values)
        eid = enrol_repo.create(conn, customer_id=customer["id"], programme_id=programme_id, source="admin",
                                created_by=g.user["id"], intake_text=intake_text, due_date=due_date,
                                target_start_date=target_start)
        audit_event(conn, "enrolment.created", "enrolment", eid, eid,
                    {"programme": programme["code"], "customer_ref": customer["customer_ref"]})
        checklist.run_check(conn, eid, actor=g.user, reason="enrolment_created")
        invite = None
        if send_invite and not users_repo.get_by_customer(conn, customer["id"]):
            invite = enrol_repo.create_invite(conn, enrolment_id=eid, email=customer["email"], created_by=g.user["id"])
            audit_event(conn, "invite.created", "invite", invite["id"], eid, {"email": customer["email"]})
        customer_user = users_repo.get_by_customer(conn, customer["id"])
        if customer_user:
            msg_repo.notify(conn, [customer_user["id"]], kind="enrolment",
                            title=f"You've been enrolled on {programme['name']}",
                            body="Your document checklist is ready.", link=f"/portal/enrolments/{eid}")
    return jsonify({"enrolment": enrol_repo.get(conn, eid), "invite": invite}), 201


def enrolment_detail_payload(conn, enrolment_id: int) -> dict:
    enrolment = enrol_repo.get(conn, enrolment_id)
    cl = checklist.checklist_for(conn, enrolment)
    return {
        "enrolment": enrolment,
        "checklist": cl,
        "submissions": sub_repo.for_enrolment(conn, enrolment_id),
        "messages": msg_repo.for_enrolment(conn, enrolment_id),
        "drafts": query_all(conn, """SELECT d.*, l.model, l.provider, l.status AS llm_status, l.latency_ms,
                                            l.input_tokens, l.output_tokens, l.prompt_version
                                     FROM reminder_drafts d LEFT JOIN llm_interactions l ON l.id = d.llm_interaction_id
                                     WHERE d.enrolment_id = ? ORDER BY d.id DESC""", [enrolment_id]),
        "invite": enrol_repo.latest_invite(conn, enrolment_id),
        "customer_has_login": users_repo.get_by_customer(conn, enrolment["customer_id"]) is not None,
        "checks": query_all(conn, "SELECT id, completion_pct, status_before, status_after, trigger_reason, created_at "
                                  "FROM onboarding_checks WHERE enrolment_id = ? ORDER BY id DESC LIMIT 10",
                            [enrolment_id]),
    }


@bp.get("/enrolments/<int:enrolment_id>")
def enrolment_detail(enrolment_id: int):
    return jsonify(enrolment_detail_payload(get_db(), enrolment_id))


@bp.post("/enrolments/<int:enrolment_id>/check")
def enrolment_check(enrolment_id: int):
    conn = get_db()
    with transaction(conn):
        result = checklist.run_check(conn, enrolment_id, actor=g.user, reason="manual")
        audit_event(conn, "checklist.compared", "enrolment", enrolment_id, enrolment_id,
                    {"check_id": result["check_id"], "completion_pct": result["completion_pct"]})
    return jsonify(enrolment_detail_payload(conn, enrolment_id))


@bp.patch("/enrolments/<int:enrolment_id>")
def enrolment_update(enrolment_id: int):
    v = Validator(body())
    values = {}
    for key in ("due_date", "target_start_date"):
        if key in v.data:
            values[key] = v.field(key, clean_date)
    v.raise_if_errors()
    if not values:
        raise ValidationError("Nothing to update.", {"body": "Send due_date and/or target_start_date."})
    conn = get_db()
    before = enrol_repo.get(conn, enrolment_id)
    with transaction(conn):
        enrol_repo.set_fields(conn, enrolment_id, values)
        audit_event(conn, "enrolment.updated", "enrolment", enrolment_id, enrolment_id,
                    {"before": {k: before[k] for k in values}, "after": values})
        if "due_date" in values and values["due_date"] != before["due_date"]:
            customer_user = users_repo.get_by_customer(conn, before["customer_id"])
            if customer_user:
                when = (date.fromisoformat(values["due_date"]).strftime("%a %-d %b %Y")
                        if values["due_date"] else "no fixed date")
                msg_repo.notify(conn, [customer_user["id"]], kind="deadline",
                                title=f"New document deadline for {before['programme_name']}",
                                body=f"Please upload your required documents by {when}.",
                                link=f"/portal/enrolments/{enrolment_id}")
    return jsonify(enrolment_detail_payload(conn, enrolment_id))


@bp.post("/enrolments/<int:enrolment_id>/complete")
def enrolment_complete(enrolment_id: int):
    """Human decision: only allowed when every mandatory document is verified."""
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    if enrolment["status"] in ("completed", "cancelled"):
        raise ConflictError(f"This enrolment is already {enrolment['status']}.")
    cl = checklist.checklist_for(conn, enrolment)
    if not cl["all_verified"]:
        unverified = [i["name"] for i in cl["items"] if i["is_mandatory"] and i["state"] != "verified"]
        raise ConflictError("All mandatory documents must be verified before completing onboarding.",
                            {"unverified": unverified})
    with transaction(conn):
        enrol_repo.set_fields(conn, enrolment_id, {"status": "completed", "completed_by": g.user["id"],
                                                   "completed_at": utcnow(), "completion_pct": 100})
        audit_event(conn, "enrolment.completed", "enrolment", enrolment_id, enrolment_id,
                    {"before": enrolment["status"], "after": "completed"})
        customer_user = users_repo.get_by_customer(conn, enrolment["customer_id"])
        if customer_user:
            msg_repo.notify(conn, [customer_user["id"]], kind="completed", title="Onboarding complete 🎉",
                            body=f"You're all set for {enrolment['programme_name']}.",
                            link=f"/portal/enrolments/{enrolment_id}")
    return jsonify(enrolment_detail_payload(conn, enrolment_id))


@bp.post("/enrolments/<int:enrolment_id>/cancel")
def enrolment_cancel(enrolment_id: int):
    v = Validator(body())
    reason = v.field("reason", clean_str, min_len=3, max_len=300, label="Reason")
    v.raise_if_errors()
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    if enrolment["status"] in ("completed", "cancelled"):
        raise ConflictError(f"This enrolment is already {enrolment['status']}.")
    with transaction(conn):
        enrol_repo.set_fields(conn, enrolment_id, {"status": "cancelled", "cancelled_at": utcnow(),
                                                   "cancellation_reason": reason})
        audit_event(conn, "enrolment.cancelled", "enrolment", enrolment_id, enrolment_id,
                    {"before": enrolment["status"], "reason": reason})
        customer_user = users_repo.get_by_customer(conn, enrolment["customer_id"])
        if customer_user:
            msg_repo.notify(conn, [customer_user["id"]], kind="enrolment_cancelled",
                            title=f"Your {enrolment['programme_name']} enrolment was cancelled",
                            body=reason, link=f"/portal/enrolments/{enrolment_id}")
    return jsonify(enrolment_detail_payload(conn, enrolment_id))


@bp.post("/enrolments/<int:enrolment_id>/invite")
def enrolment_invite(enrolment_id: int):
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    if users_repo.get_by_customer(conn, enrolment["customer_id"]):
        raise ConflictError("This customer already has a portal account.")
    with transaction(conn):
        invite = enrol_repo.create_invite(conn, enrolment_id=enrolment_id, email=enrolment["customer_email"],
                                          created_by=g.user["id"])
        audit_event(conn, "invite.created", "invite", invite["id"], enrolment_id,
                    {"email": enrolment["customer_email"]})
    return jsonify({"invite": invite}), 201


# ------------------------------------------------------------------ verification
@bp.get("/verification-queue")
def verification_queue():
    return jsonify({"items": sub_repo.verification_queue(get_db(), int_arg("limit", 100))})


def _submission_action(submission_id: int, action: str, values: dict, details: dict) -> dict:
    conn = get_db()
    sub = sub_repo.get(conn, submission_id)
    enrolment = enrol_repo.get(conn, sub["enrolment_id"])
    if enrolment["status"] in ("completed", "cancelled"):
        raise ConflictError(f"This enrolment is {enrolment['status']}; documents can no longer change.")
    if sub["status"] == "superseded":
        raise ConflictError("A newer file replaced this one. Review the latest upload instead.")
    with transaction(conn):
        sub_repo.set_fields(conn, submission_id, values)
        doc_id = values.get("required_document_id") or sub["required_document_id"]
        if action == "verified" and doc_id:
            # Once a file is verified, older attempts for the same checklist item are history.
            sub_repo.supersede_older(conn, sub["enrolment_id"], doc_id, submission_id)
        audit_event(conn, f"submission.{action}", "document_submission", submission_id, sub["enrolment_id"],
                    {"before": {"status": sub["status"], "doc_code": sub["doc_code"]}, **details})
        checklist.run_check(conn, sub["enrolment_id"], actor=g.user, reason=f"submission_{action}")
        customer_user = users_repo.get_by_customer(conn, enrolment["customer_id"])
        if customer_user and action in ("verified", "rejected"):
            doc_name = sub["document_name"] or "document"
            msg_repo.notify(conn, [customer_user["id"]], kind=f"document_{action}",
                            title=f"Your {doc_name.lower()} was {action}",
                            body=details.get("reason") or "", link=f"/portal/enrolments/{sub['enrolment_id']}")
    return enrolment_detail_payload(conn, sub["enrolment_id"])


@bp.post("/submissions/<int:submission_id>/verify")
def submission_verify(submission_id: int):
    conn = get_db()
    sub = sub_repo.get(conn, submission_id)
    if sub["status"] == "verified":
        raise ConflictError("This document is already verified.")
    if not sub["required_document_id"]:
        raise ValidationError("Assign this file to a checklist item before verifying it.",
                              {"required_document_id": "Unclassified submission."})
    return jsonify(_submission_action(submission_id, "verified",
                                      {"status": "verified", "verified_by": g.user["id"], "verified_at": utcnow(),
                                       "rejection_reason": None}, {"after": "verified"}))


@bp.post("/submissions/<int:submission_id>/reject")
def submission_reject(submission_id: int):
    v = Validator(body())
    reason = v.field("reason", clean_str, min_len=5, max_len=300, label="Reason")
    v.raise_if_errors()
    sub = sub_repo.get(get_db(), submission_id)
    if sub["status"] == "rejected":
        raise ConflictError("This document is already rejected.")
    return jsonify(_submission_action(submission_id, "rejected",
                                      {"status": "rejected", "verified_by": g.user["id"], "verified_at": utcnow(),
                                       "rejection_reason": reason}, {"after": "rejected", "reason": reason}))


@bp.post("/submissions/<int:submission_id>/reassign")
def submission_reassign(submission_id: int):
    """Officer corrects the NLP classification (e.g. it's the transcript, not the ID)."""
    v = Validator(body())
    doc_id = v.field("required_document_id", clean_id)
    v.raise_if_errors()
    conn = get_db()
    sub = sub_repo.get(conn, submission_id)
    doc = prog_repo.get_document(conn, doc_id)
    enrolment = enrol_repo.get(conn, sub["enrolment_id"])
    if doc["programme_id"] != enrolment["programme_id"]:
        raise ValidationError("That document is not part of this programme's checklist.",
                              {"required_document_id": "Wrong programme."})
    return jsonify(_submission_action(submission_id, "reassigned",
                                      {"required_document_id": doc_id, "status": "submitted"},
                                      {"after": {"doc_code": doc["doc_code"], "status": "submitted"},
                                       "nlp_suggestion": sub["detected_doc_code"]}))


# ------------------------------------------------------------------ messages
@bp.get("/messages/inbound")
def inbound_messages():
    return jsonify({"items": msg_repo.inbound_for_admin(get_db())})


@bp.post("/messages/<int:message_id>/read")
def inbound_read(message_id: int):
    conn = get_db()
    with transaction(conn):
        cur = conn.execute("UPDATE messages SET is_read = 1, read_at = ? WHERE id = ? AND direction = 'from_customer'",
                           [utcnow(), message_id])
        if cur.rowcount == 0:
            raise NotFoundError("Message not found.")
    return jsonify({"ok": True})


@bp.post("/enrolments/<int:enrolment_id>/messages")
def officer_message(enrolment_id: int):
    """A message the officer writes personally (human-authored, so no approval step needed).

    Chat-style: only the text is required. A subject is still stored (used for the customer's
    notification title); it defaults to a generic one when none is sent.
    """
    v = Validator(body())
    subject = v.field("subject", clean_str, required=False, max_len=150, label="Subject")
    text = v.field("body", clean_text_block, min_len=5, max_len=4000, label="Message")
    v.raise_if_errors()
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    subject = subject or "Message from your onboarding team"
    with transaction(conn):
        mid = msg_repo.create_message(conn, {"enrolment_id": enrolment_id, "direction": "to_customer",
                                             "subject": subject, "body": text, "author_user_id": g.user["id"]})
        audit_event(conn, "message.published", "message", mid, enrolment_id, {"subject": subject, "author": "officer"})
        customer_user = users_repo.get_by_customer(conn, enrolment["customer_id"])
        if customer_user:
            msg_repo.notify(conn, [customer_user["id"]], kind="message", title=subject,
                            body="You have a new message from the onboarding team.", link="/portal/messages")
    return jsonify(enrolment_detail_payload(conn, enrolment_id)), 201


# ------------------------------------------------------------------ NLP + documents
@bp.post("/nlp/analyze")
def nlp_analyze():
    """Live preview while the officer types – nothing is saved."""
    v = Validator(body())
    text = v.field("text", clean_text_block, min_len=1, label="Text")
    programme_id = v.field("programme_id", clean_id) if v.data.get("programme_id") else None
    v.raise_if_errors()
    conn = get_db()
    programme = prog_repo.get(conn, programme_id) if programme_id else None
    c = cfg()
    return jsonify(nlp.analyze_text(text, programme, prog_repo.list_programmes(conn),
                                    match_threshold=c.nlp_match_threshold, review_threshold=c.nlp_review_threshold))


@bp.post("/enrolments/<int:enrolment_id>/intake")
def enrolment_intake(enrolment_id: int):
    """Officer pastes a customer email/note → NLP → checklist updated."""
    v = Validator(body())
    text = v.field("text", clean_text_block, label="Customer message",
                   empty_message="Please paste the customer's message or add a file.")
    v.raise_if_errors()
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    with transaction(conn):
        result = documents.apply_intake_text(conn, cfg(), enrolment=enrolment, text=text, actor=g.user)
    return jsonify({**result, "detail": enrolment_detail_payload(conn, enrolment_id)})


@bp.post("/enrolments/<int:enrolment_id>/uploads")
def enrolment_upload(enrolment_id: int):
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    doc_id = request.form.get("required_document_id")
    note = clean_text_block(request.form.get("note"), "note", required=False, min_len=1, max_len=500, label="Note")
    with transaction(conn):
        result = documents.save_upload(conn, cfg(), enrolment=enrolment, file=request.files.get("file"), note=note,
                                       chosen_doc_id=clean_id(doc_id, "required_document_id") if doc_id else None,
                                       actor=g.user)
    return jsonify({**result, "detail": enrolment_detail_payload(conn, enrolment_id)}), 201


@bp.get("/submissions/<int:submission_id>/file")
def submission_file(submission_id: int):
    sub = sub_repo.get(get_db(), submission_id)
    path = documents.file_path(cfg(), sub)
    if not path:
        raise NotFoundError("No stored file for this submission (it may be a pasted-text entry or seed data).")
    return send_file(path, mimetype=sub["mime_type"], download_name=sub["original_filename"], as_attachment=False)


# ------------------------------------------------------------------ AI assist (Claude)
def _ai(enrolment_id: int, task: str):
    require_demo_code()
    ai_limiter().hit(f"ai:{g.user['id']}")
    v = Validator(body())
    tone = v.field("tone", clean_enum, ("friendly", "formal"), default="friendly")
    channel = v.field("channel", clean_enum, ("portal", "email", "sms"), default="portal")
    v.raise_if_errors()
    result = ai_workflow.run_ai_task(get_db(), cfg(), enrolment_id=enrolment_id, task=task, actor=g.user,
                                     tone=tone, channel=channel)
    return jsonify(result), 201


@bp.post("/enrolments/<int:enrolment_id>/ai/explain")
def ai_explain(enrolment_id: int):
    return _ai(enrolment_id, "explain_outstanding")


@bp.post("/enrolments/<int:enrolment_id>/ai/reminder")
def ai_reminder(enrolment_id: int):
    return _ai(enrolment_id, "draft_reminder")


# ------------------------------------------------------------------ review queue (human approval)
_DRAFT_SELECT = """
    SELECT d.*, e.enrolment_ref, c.full_name AS customer_name, p.name AS programme_name,
           l.model, l.provider, l.status AS llm_status, l.latency_ms, l.input_tokens, l.output_tokens,
           l.prompt_version, l.validation_errors_json, cb.full_name AS created_by_name, rv.full_name AS reviewed_by_name
    FROM reminder_drafts d
    JOIN enrolments e ON e.id = d.enrolment_id
    JOIN customers c ON c.id = e.customer_id
    JOIN programmes p ON p.id = e.programme_id
    LEFT JOIN llm_interactions l ON l.id = d.llm_interaction_id
    LEFT JOIN users cb ON cb.id = d.created_by
    LEFT JOIN users rv ON rv.id = d.reviewed_by
"""


def _draft(conn, draft_id: int) -> dict:
    rows = query_all(conn, _DRAFT_SELECT + " WHERE d.id = ?", [draft_id])
    if not rows:
        raise NotFoundError(f"Draft {draft_id} was not found.")
    d = rows[0]
    d["validation"] = from_json(d.pop("validation_errors_json"), {})
    return d


@bp.get("/drafts")
def drafts_list():
    status = request.args.get("status") or None
    if status and status not in ("draft", "published", "rejected"):
        raise ValidationError("Unknown status filter.", {"status": "Use draft, published or rejected."})
    params, where = [], ""
    if status:
        where, params = " WHERE d.status = ?", [status]
    rows = query_all(get_db(), _DRAFT_SELECT + where + " ORDER BY (d.status = 'draft') DESC, d.id DESC LIMIT 200",
                     params)
    for d in rows:
        d["validation"] = from_json(d.pop("validation_errors_json"), {})
    return jsonify({"items": rows})


@bp.get("/drafts/<int:draft_id>")
def draft_detail(draft_id: int):
    return jsonify({"draft": _draft(get_db(), draft_id)})


def _open_draft(conn, draft_id: int) -> dict:
    d = _draft(conn, draft_id)
    if d["status"] != "draft":
        raise ConflictError(f"This draft was already {d['status']}.")
    return d


@bp.patch("/drafts/<int:draft_id>")
def draft_edit(draft_id: int):
    v = Validator(body())
    subject = v.field("subject", clean_str, min_len=3, max_len=150, label="Subject")
    text = v.field("body", clean_text_block, min_len=10, max_len=4000, label="Message")
    v.raise_if_errors()
    conn = get_db()
    d = _open_draft(conn, draft_id)
    with transaction(conn):
        conn.execute("UPDATE reminder_drafts SET subject = ?, body = ? WHERE id = ?", [subject, text, draft_id])
        audit_event(conn, "draft.edited", "reminder_draft", draft_id, d["enrolment_id"],
                    {"subject_changed": subject != d["subject"], "body_changed": text != d["body"]})
    return jsonify({"draft": _draft(conn, draft_id)})


@bp.post("/drafts/<int:draft_id>/publish")
def draft_publish(draft_id: int):
    """Human approval: publish the (possibly edited) draft to the customer's portal inbox."""
    v = Validator(body())
    note = v.field("review_note", clean_str, required=False, max_len=300, label="Review note")
    v.raise_if_errors()
    conn = get_db()
    d = _open_draft(conn, draft_id)
    enrolment = enrol_repo.get(conn, d["enrolment_id"])
    edited = d["body"] != d["original_body"]
    with transaction(conn):
        now = utcnow()
        mid = msg_repo.create_message(conn, {"enrolment_id": d["enrolment_id"], "direction": "to_customer",
                                             "subject": d["subject"], "body": d["body"], "reminder_draft_id": draft_id,
                                             "author_user_id": g.user["id"]})
        conn.execute("""UPDATE reminder_drafts SET status = 'published', reviewed_by = ?, reviewed_at = ?,
                        published_at = ?, review_note = ? WHERE id = ? AND status = 'draft'""",
                     [g.user["id"], now, now, note, draft_id])
        diff = list(difflib.unified_diff(d["original_body"].splitlines(), d["body"].splitlines(),
                                         "generated", "published", lineterm="", n=0))[:40]
        audit_event(conn, "draft.published", "reminder_draft", draft_id, d["enrolment_id"],
                    {"message_id": mid, "edited_by_human": edited, "is_fallback": bool(d["is_fallback"]),
                     "channel": d["channel"], "diff": diff})
        customer_user = users_repo.get_by_customer(conn, enrolment["customer_id"])
        if customer_user:
            msg_repo.notify(conn, [customer_user["id"]], kind="message", title=d["subject"],
                            body="You have a new message from the onboarding team.", link="/portal/messages")
    payload = {"draft": _draft(conn, draft_id), "message_id": mid}
    if d["channel"] != "portal":
        payload["notice"] = (f"Published to the customer portal. {d['channel'].upper()} delivery is not connected "
                             "in this prototype – copy the text if you need to send it manually.")
    return jsonify(payload)


@bp.post("/drafts/<int:draft_id>/reject")
def draft_reject(draft_id: int):
    v = Validator(body())
    reason = v.field("reason", clean_str, min_len=3, max_len=300, label="Reason")
    v.raise_if_errors()
    conn = get_db()
    d = _open_draft(conn, draft_id)
    with transaction(conn):
        conn.execute("""UPDATE reminder_drafts SET status = 'rejected', reviewed_by = ?, reviewed_at = ?,
                        review_note = ? WHERE id = ?""", [g.user["id"], utcnow(), reason, draft_id])
        audit_event(conn, "draft.rejected", "reminder_draft", draft_id, d["enrolment_id"], {"reason": reason})
    return jsonify({"draft": _draft(conn, draft_id)})


# ------------------------------------------------------------------ pipeline trace
@bp.get("/enrolments/<int:enrolment_id>/trace")
def enrolment_trace(enrolment_id: int):
    conn = get_db()
    enrolment = enrol_repo.get(conn, enrolment_id)
    events = []
    for x in query_all(conn, "SELECT * FROM nlp_extractions WHERE enrolment_id = ?", [enrolment_id]):
        events.append({"type": "nlp", "id": x["id"], "at": x["created_at"], "source": x["source_type"],
                       "input_excerpt": x["input_excerpt"], "clean_text": x["clean_text"], "intent": x["intent"],
                       "entities": from_json(x["entities_json"], {}),
                       "detected_service": from_json(x["detected_service_json"], {}),
                       "matches": from_json(x["document_matches_json"], []),
                       "tokens": from_json(x["tokens_json"], [])[:60], "pipeline_version": x["pipeline_version"],
                       "submission_id": x["submission_id"]})
    for c in query_all(conn, "SELECT * FROM onboarding_checks WHERE enrolment_id = ?", [enrolment_id]):
        events.append({"type": "check", "id": c["id"], "at": c["created_at"], "completion_pct": c["completion_pct"],
                       "collected": c["collected_count"], "verified": c["verified_count"],
                       "required": c["required_count"], "missing": from_json(c["missing_json"], []),
                       "status_before": c["status_before"], "status_after": c["status_after"],
                       "reason": c["trigger_reason"]})
    for l in query_all(conn, "SELECT * FROM llm_interactions WHERE enrolment_id = ?", [enrolment_id]):
        events.append({"type": "llm", "id": l["id"], "at": l["created_at"], "task": l["task"],
                       "provider": l["provider"], "model": l["model"], "status": l["status"],
                       "prompt_version": l["prompt_version"], "request": from_json(l["request_json"], {}),
                       "response_text": l["response_text"], "parsed": from_json(l["parsed_json"], {}),
                       "input_tokens": l["input_tokens"], "output_tokens": l["output_tokens"],
                       "latency_ms": l["latency_ms"], "request_id": l["request_id"], "attempts": l["attempts"],
                       "error": l["error_message"], "validation": from_json(l["validation_errors_json"], {}),
                       "check_id": l["check_id"]})
    for d in query_all(conn, "SELECT id, status, subject, is_fallback, created_at, reviewed_at, published_at, "
                             "llm_interaction_id FROM reminder_drafts WHERE enrolment_id = ?", [enrolment_id]):
        events.append({"type": "draft", **d, "at": d["created_at"]})
    for m in msg_repo.for_enrolment(conn, enrolment_id):
        events.append({"type": "message", "id": m["id"], "at": m["created_at"], "direction": m["direction"],
                       "subject": m["subject"], "intent": m.get("nlp_intent"), "author": m["author_name"]})
    events.sort(key=lambda e: (e["at"], {"nlp": 0, "check": 1, "llm": 2, "draft": 3, "message": 4}[e["type"]],
                               e["id"]), reverse=True)
    return jsonify({"enrolment": enrolment, "events": events,
                    "audit": audit.list_entries(conn, enrolment_id=enrolment_id, limit=100)["items"]})


@bp.get("/llm/status")
def llm_status():
    c = cfg()
    from ..llm.prompts import available_versions
    return jsonify({"provider": c.llm_provider, "provider_label": c.provider_label,
                    "configured": c.llm_configured, "model": c.active_model,
                    "effort": c.llm_effort, "prompt_version": c.prompt_version,
                    "prompt_versions": available_versions(), "timeout_seconds": c.llm_timeout_seconds,
                    "max_retries": c.llm_max_retries, "demo_code_required": bool(c.demo_access_code)})
