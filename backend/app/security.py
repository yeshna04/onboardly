"""Sessions, role checks, CSRF guard and simple in-memory rate limiting."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from functools import wraps
from typing import Callable

from flask import current_app, g, request, session

from .db import get_db
from .errors import AuthenticationError, PermissionDenied, RateLimitError
from .repo import users as users_repo

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "X-Requested-With"


def load_current_user() -> None:
    """before_request hook: put the signed-in user (or None) on ``g.user``."""
    g.user = None
    uid = session.get("uid")
    if uid:
        user = users_repo.get(get_db(), uid)
        if user and user["is_active"]:
            g.user = user
        else:
            session.clear()


def csrf_guard() -> None:
    """Mutating API calls must carry a custom header.

    Browsers only allow cross-site requests to set custom headers after a CORS
    pre-flight, which this API never approves, so a forged form post from
    another site cannot pass. Combined with SameSite=Lax cookies this is a
    lightweight CSRF defence suited to a JSON API.
    """
    if request.method in SAFE_METHODS or not request.path.startswith("/api/"):
        return
    if request.headers.get(CSRF_HEADER) != "fetch":
        raise PermissionDenied("Missing request header. Please use the app UI or send X-Requested-With: fetch.")


def login_user(user: dict) -> None:
    session.clear()
    session["uid"] = user["id"]
    session["role"] = user["role"]
    session.permanent = True


def logout_user() -> None:
    session.clear()


def require_role(*roles: str) -> Callable:
    """Decorator: user must be signed in and (optionally) have one of ``roles``."""

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if g.get("user") is None:
                raise AuthenticationError("Please sign in to continue.")
            if roles and g.user["role"] not in roles:
                raise PermissionDenied("You don't have access to this area.")
            return fn(*args, **kwargs)
        return wrapper

    return decorator


admin_required = require_role("admin")
customer_required = require_role("customer")
login_required = require_role()


def client_ip() -> str:
    # Render sits behind a proxy; take the first X-Forwarded-For hop when present.
    forwarded = request.headers.get("X-Forwarded-For", "")
    return (forwarded.split(",")[0].strip() if forwarded else request.remote_addr) or "unknown"


class RateLimiter:
    """Sliding-window limiter: at most ``limit`` hits per ``window`` seconds per key."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                retry = int(self.window - (now - q[0])) + 1
                raise RateLimitError(f"Too many requests. Please wait {retry}s and try again.",
                                     {"retry_after_seconds": retry})
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = RateLimiter(limit=10, window=300)


def ai_limiter() -> RateLimiter:
    return current_app.extensions["ai_limiter"]


def require_demo_code() -> None:
    """On a public deployment, AI actions need the shared demo access code (header X-Demo-Code)."""
    import hmac
    expected = current_app.config["APP_CONFIG"].demo_access_code
    if not expected:
        return
    supplied = request.headers.get("X-Demo-Code", "")
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise PermissionDenied("Enter the demo access code to use AI features.", {"demo_code": "required"})
