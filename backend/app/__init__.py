"""Flask application factory."""
from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

from .config import Config
from .db import close_db, connect, migrate
from .errors import register_error_handlers
from .security import RateLimiter, csrf_guard, load_current_user


def create_app(config: Config | None = None) -> Flask:
    cfg = config or Config.from_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    app = Flask(__name__, static_folder=None)
    app.config.update(
        APP_CONFIG=cfg,
        SECRET_KEY=cfg.secret_key,
        MAX_CONTENT_LENGTH=cfg.max_upload_mb * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=cfg.is_production,
        SESSION_COOKIE_NAME="onboarding_session",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        JSON_SORT_KEYS=False,
    )
    app.extensions["ai_limiter"] = RateLimiter(limit=cfg.ai_rate_limit_per_minute, window=60)
    cfg.upload_dir.mkdir(parents=True, exist_ok=True)
    if cfg.database_path.exists():
        conn = connect(cfg.database_path)
        try:
            migrate(conn)
        finally:
            conn.close()

    app.before_request(load_current_user)
    app.before_request(csrf_guard)
    app.teardown_appcontext(close_db)
    register_error_handlers(app)

    from .routes import admin, auth, portal, public
    app.register_blueprint(public.bp)
    app.register_blueprint(auth.bp)
    app.register_blueprint(admin.bp)
    app.register_blueprint(portal.bp)

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        return resp

    _register_frontend(app, cfg.frontend_dist)
    return app


def _register_frontend(app: Flask, dist: Path) -> None:
    """Serve the built React app (single-page app) for every non-API path."""

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path: str):
        if path.startswith("api/"):
            return jsonify({"error": {"code": "not_found", "message": "Unknown API endpoint."}}), 404
        if not (dist / "index.html").is_file():
            return jsonify({"message": "API is running. Build the frontend (cd frontend && npm run build) "
                                       "or use the Vite dev server on http://localhost:5173."})
        target = dist / path
        if path and target.is_file() and dist in target.resolve().parents:
            return send_from_directory(dist, path)
        return send_from_directory(dist, "index.html")
