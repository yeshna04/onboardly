"""Custom exception hierarchy and Flask JSON error handlers.

Every error the API returns has the same shape::

    {"error": {"code": "validation_error", "message": "...", "details": {...}}}
"""
from __future__ import annotations

import logging
from typing import Any

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for expected, user-facing errors."""

    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, details: Any = None):
        super().__init__(message)
        self.message = message
        self.details = details

    def to_dict(self) -> dict:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            body["details"] = self.details
        return {"error": body}


class ValidationError(AppError):
    """Input failed validation. ``details`` maps field name -> problem."""

    status_code = 400
    code = "validation_error"


class AuthenticationError(AppError):
    status_code = 401
    code = "not_authenticated"


class PermissionDenied(AppError):
    status_code = 403
    code = "forbidden"


class DemoAccountError(PermissionDenied):
    """A shared demo login tried to change something."""

    code = "demo_account"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class UnsupportedRequestError(AppError):
    """Request is well-formed but outside what the assistant supports."""

    status_code = 422
    code = "unsupported_request"


class RateLimitError(AppError):
    status_code = 429
    code = "rate_limited"


class ExternalServiceError(AppError):
    """An upstream dependency (e.g. the LLM provider) failed."""

    status_code = 502
    code = "external_service_error"


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(AppError)
    def handle_app_error(err: AppError):
        return jsonify(err.to_dict()), err.status_code

    @app.errorhandler(HTTPException)
    def handle_http_error(err: HTTPException):
        code = (err.name or "http_error").lower().replace(" ", "_")
        if err.code == 413:
            code, message = "file_too_large", "The uploaded file is larger than the allowed limit."
        else:
            message = err.description or err.name
        return jsonify({"error": {"code": code, "message": message}}), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err: Exception):
        log.exception("Unhandled error: %s", err)
        return jsonify({"error": {"code": "internal_error",
                                  "message": "Something went wrong on our side. The error has been logged."}}), 500
