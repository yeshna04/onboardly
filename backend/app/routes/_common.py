"""Helpers shared by route modules."""
from __future__ import annotations

from flask import current_app, g, request

from ..config import Config
from ..repo import audit
from ..security import client_ip


def cfg() -> Config:
    return current_app.config["APP_CONFIG"]


def body() -> dict:
    """JSON body or {} (validation happens in the route)."""
    return request.get_json(silent=True) or {}


def audit_event(conn, action: str, entity_type: str, entity_id=None, enrolment_id=None, details=None) -> None:
    audit.record(conn, action=action, entity_type=entity_type, entity_id=entity_id, enrolment_id=enrolment_id,
                 actor=g.get("user"), details=details, ip_address=client_ip())


def int_arg(name: str, default: int, lo: int = 1, hi: int = 500) -> int:
    try:
        value = int(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))
