"""Import customers from a CRM export (CSV or JSON) using pandas.

Steps
  1. Load the file into a DataFrame (``load_export``).
  2. Normalise and validate every row, collecting row-level errors
     (``validate_frame``) – bad rows are reported, never silently dropped.
  3. Insert valid rows that are not already in the SQLite mirror
     (``import_customers``) and return a report the UI can render.
"""
from __future__ import annotations

import io
import sqlite3
from pathlib import Path
from typing import IO, Any

import pandas as pd

from ..errors import ValidationError
from ..repo import audit
from ..repo import customers as cust_repo
from ..validation import EMAIL_RE, PHONE_RE

REQUIRED_COLUMNS = ["full_name", "email"]
OPTIONAL_COLUMNS = ["customer_ref", "phone", "country"]
COLUMN_ALIASES = {
    "name": "full_name", "customer_name": "full_name", "fullname": "full_name",
    "email_address": "email", "mail": "email",
    "ref": "customer_ref", "crm_id": "customer_ref", "id": "customer_ref",
    "mobile": "phone", "phone_number": "phone",
}
MAX_ROWS = 5000


def load_export(source: str | Path | IO[bytes] | IO[str], filename: str | None = None) -> pd.DataFrame:
    """Read CSV or JSON (array of objects) into a DataFrame of strings."""
    name = (filename or (str(source) if isinstance(source, (str, Path)) else "")).lower()
    try:
        if isinstance(source, (bytes, bytearray)):
            source = io.BytesIO(source)
        if name.endswith(".json"):
            df = pd.read_json(source, orient="records", dtype=False)
        else:
            df = pd.read_csv(source, dtype=str, keep_default_na=False, skipinitialspace=True)
    except (ValueError, pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise ValidationError("The file could not be read as CSV/JSON.", {"file": str(exc)[:200]})
    if df.empty:
        raise ValidationError("The file has no data rows.", {"file": "No rows found."})
    if len(df) > MAX_ROWS:
        raise ValidationError(f"Too many rows (max {MAX_ROWS}).", {"file": f"{len(df)} rows supplied."})
    df.columns = [COLUMN_ALIASES.get(c.strip().lower().replace(" ", "_"), c.strip().lower().replace(" ", "_"))
                  for c in df.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValidationError("Required columns are missing.", {"columns": f"Missing: {', '.join(missing)}"})
    for col in OPTIONAL_COLUMNS:
        if col not in df.columns:
            df[col] = ""
    df = df[REQUIRED_COLUMNS + OPTIONAL_COLUMNS].fillna("").astype(str)
    return df.apply(lambda s: s.str.strip())


def validate_frame(df: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """Return (valid_rows, errors). Row numbers are 1-based data rows (+1 for the header line)."""
    df = df.copy()
    df["email"] = df["email"].str.lower()
    df["customer_ref"] = df["customer_ref"].str.upper()
    df["_row"] = range(2, len(df) + 2)
    errors: list[dict[str, Any]] = []

    def flag(mask: pd.Series, field: str, message: str) -> None:
        for _, r in df[mask].iterrows():
            errors.append({"row": int(r["_row"]), "customer_ref": r["customer_ref"] or None,
                           "field": field, "message": message})

    bad_name = df["full_name"].str.len() < 2
    bad_email = ~df["email"].apply(lambda v: bool(EMAIL_RE.match(v)))
    bad_phone = (df["phone"] != "") & ~df["phone"].apply(lambda v: bool(PHONE_RE.match(v)))
    flag(bad_name, "full_name", "Name is missing or too short.")
    flag(bad_email, "email", "Email is missing or invalid.")
    flag(bad_phone, "phone", "Phone number is invalid.")
    invalid = bad_name | bad_email | bad_phone

    dup_email = df["email"].duplicated(keep="first") & ~bad_email
    dup_ref = (df["customer_ref"] != "") & df["customer_ref"].duplicated(keep="first")
    flag(dup_email & ~invalid, "email", "Duplicate email within this file (first occurrence kept).")
    flag(dup_ref & ~invalid & ~dup_email, "customer_ref", "Duplicate customer_ref within this file.")
    invalid = invalid | dup_email | dup_ref

    errors.sort(key=lambda e: e["row"])
    return df[~invalid].copy(), errors


def import_customers(conn: sqlite3.Connection, source, *, filename: str | None = None,
                     actor: dict | None = None, source_label: str = "crm_import") -> dict[str, Any]:
    """Validate and insert. Caller owns the transaction."""
    df = load_export(source, filename)
    valid, errors = validate_frame(df)
    imported, skipped = [], []
    for _, r in valid.iterrows():
        existing = cust_repo.find_by_email(conn, r["email"]) or (
            cust_repo.find_by_ref(conn, r["customer_ref"]) if r["customer_ref"] else None)
        if existing:
            skipped.append({"row": int(r["_row"]), "customer_ref": existing["customer_ref"],
                            "message": "Already in the system – skipped."})
            continue
        cid = cust_repo.create(conn, full_name=r["full_name"], email=r["email"], phone=r["phone"] or None,
                               country=r["country"] or None, source=source_label,
                               customer_ref=r["customer_ref"] or None)
        imported.append({"row": int(r["_row"]), "id": cid, "full_name": r["full_name"]})

    report = {
        "total_rows": int(len(df)),
        "imported": len(imported),
        "skipped_existing": len(skipped),
        "rejected": len({e["row"] for e in errors}),
        "imported_rows": imported,
        "skipped_rows": skipped,
        "errors": errors,
        "by_country": (valid["country"].replace("", "Unknown").value_counts().to_dict() if len(valid) else {}),
    }
    audit.record(conn, action="crm.import", entity_type="customer", actor=actor,
                 details={k: report[k] for k in ("total_rows", "imported", "skipped_existing", "rejected")}
                 | {"filename": filename})
    return report
