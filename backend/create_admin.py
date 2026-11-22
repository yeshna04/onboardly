"""Create an onboarding-officer (admin) login from the command line.

Admins can't sign up through the website on purpose – the public sign-up page only
creates customer accounts. Run this on the machine (or Render shell) that holds the DB:

    .venv/bin/python create_admin.py --email you@example.com --name "Your Name"

The password is asked for interactively (hidden) so it never ends up in shell history.
"""
from __future__ import annotations

import argparse
import getpass
import sys

from app.config import Config
from app.db import connect
from app.errors import AppError
from app.repo import audit
from app.repo import users as users_repo
from app.validation import clean_email, clean_name, clean_password


def main() -> int:
    parser = argparse.ArgumentParser(description="Create an admin (onboarding officer) account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="Full name shown in the admin portal")
    args = parser.parse_args()

    cfg = Config.from_env()
    if not cfg.database_path.exists():
        print(f"No database at {cfg.database_path}. Run `python seed.py` first.", file=sys.stderr)
        return 1
    try:
        email = clean_email(args.email)
        name = clean_name(args.name)
        password = getpass.getpass("Password (min 8 chars, a letter and a number): ")
        if getpass.getpass("Repeat password: ") != password:
            print("Passwords don't match.", file=sys.stderr)
            return 1
        password = clean_password(password)
        conn = connect(cfg.database_path)
        with conn:
            user_id = users_repo.create(conn, email=email, password=password, full_name=name, role="admin")
            audit.record(conn, action="user.admin_created", entity_type="user", entity_id=user_id,
                         details={"email": email, "source": "create_admin.py"})
        conn.close()
    except AppError as exc:
        detail = "; ".join(str(v) for v in (exc.details or {}).values()) if isinstance(exc.details, dict) else ""
        print(f"Could not create admin: {exc.message} {detail}".strip(), file=sys.stderr)
        return 1
    print(f"Admin created: {email} (id {user_id}). Sign in at /login.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
