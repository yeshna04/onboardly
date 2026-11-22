"""LMS/CRM connector boundary.

The prototype has no access to a real CRM or LMS. Instead, data arrives as
export files (CSV/JSON) and is mirrored into SQLite. Keeping this code in its
own package means a real, approved API client could replace it later without
touching the rest of the app.
"""
