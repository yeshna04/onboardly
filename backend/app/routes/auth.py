"""Sign-in, sign-out, self sign-up (self-enrol) and invite acceptance."""
from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify

from ..db import get_db, transaction, utcnow
from ..errors import AuthenticationError, ConflictError, NotFoundError, ValidationError
from ..repo import customers as cust_repo
from ..repo import enrolments as enrol_repo
from ..repo import messages as msg_repo
from ..repo import programmes as prog_repo
from ..repo import users as users_repo
from ..security import client_ip, login_limiter, login_required, login_user, logout_user
from ..services import checklist
from ..validation import (Validator, clean_email, clean_id, clean_name, clean_password, clean_phone, clean_str,
                          clean_text_block, parse_iso)
from ._common import audit_event, body, cfg

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _user_payload(user: dict) -> dict:
    return {**{k: user[k] for k in ("id", "email", "full_name", "role", "customer_id")},
            "is_demo": bool(user.get("is_demo"))}


@bp.post("/login")
def login():
    login_limiter.hit(f"login:{client_ip()}")
    v = Validator(body())
    email = v.field("email", clean_email)
    password = v.data.get("password")
    if not password:
        v.errors["password"] = "Password is required."
    v.raise_if_errors()

    conn = get_db()
    row = users_repo.get_by_email_with_hash(conn, email)
    if not row or not row["is_active"] or not users_repo.verify_password(row, password):
        with transaction(conn):
            audit_event(conn, "auth.login_failed", "user", row["id"] if row else None, details={"email": email})
        raise AuthenticationError("Email or password is incorrect.")
    with transaction(conn):
        users_repo.touch_login(conn, row["id"])
        g.user = users_repo.get(conn, row["id"])
        audit_event(conn, "auth.login", "user", row["id"])
    login_user(g.user)
    return jsonify({"user": _user_payload(g.user)})


@bp.post("/logout")
def logout():
    logout_user()
    return jsonify({"ok": True})


@bp.get("/me")
@login_required
def me():
    return jsonify({"user": _user_payload(g.user)})


@bp.post("/signup")
def signup():
    """Customer self-service: create customer + login + first enrolment in one step."""
    login_limiter.hit(f"signup:{client_ip()}")
    v = Validator(body())
    full_name = v.field("full_name", clean_name)
    email = v.field("email", clean_email)
    password = v.field("password", clean_password)
    phone = v.field("phone", clean_phone)
    country = v.field("country", clean_str, required=False, max_len=60)
    programme_id = v.field("programme_id", clean_id)
    note = v.field("note", clean_text_block, required=False, label="Note")
    v.raise_if_errors()

    conn = get_db()
    programme = prog_repo.get(conn, programme_id)
    if not programme["is_active"]:
        raise ValidationError("That programme is not open for enrolment.", {"programme_id": "Not available."})
    if cust_repo.find_by_email(conn, email) or users_repo.get_by_email_with_hash(conn, email):
        raise ConflictError("An account with this email already exists. Please sign in instead.",
                            {"email": "Already registered."})
    with transaction(conn):
        customer_id = cust_repo.create(conn, full_name=full_name, email=email, phone=phone, country=country,
                                       source="self_signup")
        user_id = users_repo.create(conn, email=email, password=password, full_name=full_name,
                                    role="customer", customer_id=customer_id)
        g.user = users_repo.get(conn, user_id)
        enrolment_id = enrol_repo.create(conn, customer_id=customer_id, programme_id=programme_id,
                                         source="self_service", created_by=user_id, intake_text=note,
                                         due_date=enrol_repo.default_due_date(cfg().default_due_days))
        checklist.run_check(conn, enrolment_id, actor=g.user, reason="enrolment_created")
        audit_event(conn, "customer.self_signup", "customer", customer_id, enrolment_id,
                    {"programme": programme["code"]})
        msg_repo.notify(conn, users_repo.admin_ids(conn), kind="enrolment", title="New self-service enrolment",
                        body=f"{full_name} enrolled on {programme['name']}.", link=f"/admin/enrolments/{enrolment_id}")
    login_user(g.user)
    return jsonify({"user": _user_payload(g.user), "enrolment_id": enrolment_id}), 201


def _valid_invite(conn, code: str) -> dict:
    code = clean_str(code, "code", max_len=64)
    invite = enrol_repo.get_invite(conn, code)
    if not invite:
        raise NotFoundError("This invite link is not valid.")
    if invite["status"] != "pending":
        raise ConflictError("This invite has already been used or was revoked. Please sign in instead.")
    expires = parse_iso(invite["expires_at"])
    if expires and expires < datetime.now(timezone.utc):
        raise ConflictError("This invite has expired. Ask your onboarding officer for a new link.")
    return invite


@bp.get("/invite/<code>")
def invite_preview(code: str):
    invite = _valid_invite(get_db(), code)
    return jsonify({"invite": {k: invite[k] for k in
                               ("email", "customer_name", "programme_name", "enrolment_ref", "expires_at")}})


@bp.post("/invite/<code>/accept")
def invite_accept(code: str):
    login_limiter.hit(f"invite:{client_ip()}")
    conn = get_db()
    invite = _valid_invite(conn, code)
    v = Validator(body())
    password = v.field("password", clean_password)
    v.raise_if_errors()

    customer = cust_repo.get(conn, invite["customer_id"])
    with transaction(conn):
        existing = users_repo.get_by_customer(conn, customer["id"])
        if existing:
            raise ConflictError("You already have an account. Please sign in.", {"email": customer["email"]})
        user_id = users_repo.create(conn, email=customer["email"], password=password,
                                    full_name=customer["full_name"], role="customer", customer_id=customer["id"])
        conn.execute("UPDATE invites SET status = 'accepted', accepted_at = ? WHERE id = ?", [utcnow(), invite["id"]])
        g.user = users_repo.get(conn, user_id)
        audit_event(conn, "invite.accepted", "invite", invite["id"], invite["enrolment_id"])
        msg_repo.notify(conn, users_repo.admin_ids(conn), kind="invite", title="Invite accepted",
                        body=f"{customer['full_name']} joined the customer portal.",
                        link=f"/admin/enrolments/{invite['enrolment_id']}")
    login_user(g.user)
    return jsonify({"user": _user_payload(g.user), "enrolment_id": invite["enrolment_id"]}), 201
