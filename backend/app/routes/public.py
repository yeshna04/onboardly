"""Unauthenticated endpoints: health check and the programme catalogue."""
from __future__ import annotations

from flask import Blueprint, g, jsonify

from ..db import get_db, scalar, transaction
from ..repo import messages as msg_repo
from ..repo import programmes as prog_repo
from ..security import login_required
from ._common import cfg

bp = Blueprint("public", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    conn = get_db()
    return jsonify({
        "status": "ok",
        "database": "ok" if scalar(conn, "SELECT 1") == 1 else "error",
        "llm": {"provider": cfg().llm_provider, "configured": cfg().llm_configured, "model": cfg().active_model},
        "demo_code_required": bool(cfg().demo_access_code),
    })


@bp.get("/notifications")
@login_required
def notifications():
    return jsonify(msg_repo.notifications_for(get_db(), g.user["id"]))


@bp.post("/notifications/read")
@login_required
def notifications_read():
    conn = get_db()
    with transaction(conn):
        msg_repo.mark_notifications_read(conn, g.user["id"])
    return jsonify({"ok": True})


@bp.get("/programmes")
def programmes():
    """Active programmes with their required documents (used by sign-up and the wizard)."""
    items = prog_repo.list_programmes(get_db())
    for p in items:
        p.pop("enrolment_count", None)
    return jsonify({"items": items})
