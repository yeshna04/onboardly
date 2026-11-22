"""Input validation helpers.

Each ``clean_*`` function either returns a normalised value or raises
``ValidationError`` with a ``{field: message}`` details dict. ``Validator``
collects several field errors so the UI can highlight them all at once.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Callable, Iterable

from .errors import ValidationError

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()-]{5,20}$")
NAME_RE = re.compile(r"^[^\d<>{}\[\]@#$%^*=+|\\/~`]{2,100}$")
CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")

MAX_TEXT = 20_000


def require_json(payload: Any) -> dict:
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.", {"body": "Expected a JSON object."})
    return payload


def clean_str(value: Any, field: str, *, required: bool = True, min_len: int = 1,
              max_len: int = 255, label: str | None = None) -> str | None:
    label = label or field.replace("_", " ").capitalize()
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValidationError(f"{label} is required.", {field: f"{label} is required."})
        return None
    if not isinstance(value, (str, int, float)):
        raise ValidationError(f"{label} must be text.", {field: f"{label} must be text."})
    text = re.sub(r"\s+", " ", str(value)).strip()
    if len(text) < min_len:
        raise ValidationError(f"{label} is too short.", {field: f"Use at least {min_len} characters."})
    if len(text) > max_len:
        raise ValidationError(f"{label} is too long.", {field: f"Use at most {max_len} characters."})
    return text


def clean_text_block(value: Any, field: str, *, required: bool = True, min_len: int = 3,
                     max_len: int = MAX_TEXT, label: str | None = None,
                     empty_message: str | None = None) -> str | None:
    """Multi-line free text (emails, notes). Keeps line breaks, strips control chars."""
    label = label or field.replace("_", " ").capitalize()
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValidationError(f"{label} is empty.", {field: empty_message or f"{label} is required."})
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{label} must be text.", {field: f"{label} must be text."})
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value).strip()
    if len(text) < min_len:
        raise ValidationError(f"{label} is too short.", {field: f"Use at least {min_len} characters."})
    if len(text) > max_len:
        raise ValidationError(f"{label} is too long.", {field: f"Use at most {max_len} characters."})
    return text


def clean_email(value: Any, field: str = "email", required: bool = True) -> str | None:
    text = clean_str(value, field, required=required, max_len=254, label="Email")
    if text is None:
        return None
    text = text.lower()
    if not EMAIL_RE.match(text):
        raise ValidationError("Email looks invalid.", {field: "Enter a valid email address."})
    return text


def clean_phone(value: Any, field: str = "phone", required: bool = False) -> str | None:
    text = clean_str(value, field, required=required, max_len=25, label="Phone")
    if text is None:
        return None
    if not PHONE_RE.match(text):
        raise ValidationError("Phone number looks invalid.",
                              {field: "Use digits, spaces, dashes and an optional leading +."})
    return text


def clean_name(value: Any, field: str = "full_name") -> str:
    text = clean_str(value, field, min_len=2, max_len=100, label="Name")
    if not NAME_RE.match(text):
        raise ValidationError("Name contains invalid characters.", {field: "Letters, spaces and . ' - only."})
    return text


def clean_password(value: Any, field: str = "password") -> str:
    if not isinstance(value, str) or not value:
        raise ValidationError("Password is required.", {field: "Password is required."})
    if len(value) < 8:
        raise ValidationError("Password is too short.", {field: "Use at least 8 characters."})
    if len(value) > 128:
        raise ValidationError("Password is too long.", {field: "Use at most 128 characters."})
    if not (re.search(r"[A-Za-z]", value) and re.search(r"\d", value)):
        raise ValidationError("Password is too weak.", {field: "Include at least one letter and one number."})
    return value


def clean_enum(value: Any, field: str, allowed: Iterable[str], *, required: bool = True,
               default: str | None = None) -> str | None:
    allowed = tuple(allowed)
    if value is None or value == "":
        if required and default is None:
            raise ValidationError(f"{field} is required.", {field: f"Choose one of: {', '.join(allowed)}."})
        return default
    if not isinstance(value, str) or value not in allowed:
        raise ValidationError(f"Unsupported {field}.", {field: f"Choose one of: {', '.join(allowed)}."})
    return value


def clean_id(value: Any, field: str = "id") -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a whole number.", {field: "Must be a positive whole number."})
    if number <= 0 or (isinstance(value, float) and not value.is_integer()):
        raise ValidationError(f"{field} must be positive.", {field: "Must be a positive whole number."})
    return number


def clean_int(value: Any, field: str, *, min_value: int | None = None, max_value: int | None = None,
              required: bool = True, default: int | None = None) -> int | None:
    if value is None or value == "":
        if required and default is None:
            raise ValidationError(f"{field} is required.", {field: "Required."})
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a number.", {field: "Must be a whole number."})
    if min_value is not None and number < min_value:
        raise ValidationError(f"{field} is too small.", {field: f"Must be ≥ {min_value}."})
    if max_value is not None and number > max_value:
        raise ValidationError(f"{field} is too large.", {field: f"Must be ≤ {max_value}."})
    return number


def clean_bool(value: Any, field: str, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, str)) and str(value).lower() in {"1", "true", "yes", "on", "0", "false", "no", "off"}:
        return str(value).lower() in {"1", "true", "yes", "on"}
    raise ValidationError(f"{field} must be true or false.", {field: "Must be true or false."})


def clean_date(value: Any, field: str, *, required: bool = False) -> str | None:
    if value is None or value == "":
        if required:
            raise ValidationError(f"{field} is required.", {field: "Required (YYYY-MM-DD)."})
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise ValidationError(f"{field} must be a date.", {field: "Use the format YYYY-MM-DD."})


def clean_code(value: Any, field: str = "code") -> str:
    text = clean_str(value, field, max_len=32, label="Code")
    text = text.upper().replace(" ", "_").replace("-", "_")
    if not CODE_RE.match(text):
        raise ValidationError("Code is invalid.", {field: "Use capital letters, digits and _ (start with a letter)."})
    return text


def clean_keywords(value: Any, field: str = "keywords") -> str:
    """Accept a list or comma text; return a normalised comma-separated string."""
    if value is None or value == "":
        return ""
    items = value if isinstance(value, list) else str(value).split(",")
    words = []
    for item in items:
        word = re.sub(r"\s+", " ", str(item)).strip().lower()
        if word and word not in words:
            words.append(word[:60])
    if len(words) > 50:
        raise ValidationError("Too many keywords.", {field: "Use at most 50 keywords."})
    return ", ".join(words)


class Validator:
    """Collect several field errors before raising one ValidationError.

    >>> v = Validator(payload)
    >>> name = v.field("full_name", clean_name)
    >>> v.raise_if_errors()
    """

    def __init__(self, payload: Any):
        self.data = require_json(payload)
        self.errors: dict[str, str] = {}

    def field(self, name: str, fn: Callable[..., Any], *args, **kwargs) -> Any:
        try:
            return fn(self.data.get(name), name, *args, **kwargs)
        except ValidationError as exc:
            if isinstance(exc.details, dict):
                self.errors.update(exc.details)
            else:
                self.errors[name] = exc.message
            return None

    def raise_if_errors(self) -> None:
        if self.errors:
            first = next(iter(self.errors.values()))
            raise ValidationError(f"Please fix the highlighted fields. {first}", self.errors)


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
