"""Deterministic templates used when Claude is unavailable or its output fails validation.

They are built only from checklist data, so they are always grounded; the UI labels them
"Template – not AI".
"""
from __future__ import annotations

from datetime import date


def _nice_date(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return date.fromisoformat(iso[:10]).strftime("%-d %B %Y")
    except ValueError:
        return None


def _line(item: dict) -> str:
    if item["state"] == "rejected":
        reason = item.get("rejection_reason") or "it could not be accepted"
        return f"- {item['name']}: please upload a new copy ({reason.rstrip('.')})."
    if item["state"] == "expired":
        return f"- {item['name']}: the copy we have has expired, please upload a recent one."
    if item["state"] == "pending":
        return f"- {item['name']}: you mentioned this would follow, please upload it when ready."
    return f"- {item['name']}: {item['description']}"


def reminder(context: dict, tone: str, channel: str) -> dict:
    items = [i for i in context["items"] if i["doc_code"] in context["customer_actionable"]]
    name = context["customer_first_name"]
    due = _nice_date(context.get("due_date"))
    n = len(items)
    noun = "document" if n == 1 else "documents"
    subject = f"{n} {noun} needed for your {context['programme']}"
    if channel == "sms":
        names = ", ".join(i["name"].lower() for i in items)
        body = (f"Hi {name}, to finish onboarding for {context['programme']} we still need: {names}. "
                f"Please upload via your portal{f' by {due}' if due else ''}. The Onboarding Team")
    else:
        opener = (f"Hi {name},\n\nThank you for your progress so far." if tone == "friendly"
                  else f"Dear {name},\n\nThank you for your enrolment.")
        deadline = f" by {due}" if due else ""
        body = "\n".join([
            opener, "", f"To complete your onboarding for {context['programme']} we still need:",
            *[_line(i) for i in items], "",
            f"Please upload {'it' if n == 1 else 'them'} through your onboarding portal{deadline}.", "",
            "Best wishes," if tone == "friendly" else "Kind regards,", "The Onboarding Team",
        ])
    return {"subject": subject, "body": body, "mentioned_doc_codes": [i["doc_code"] for i in items],
            "call_to_action": "Upload the outstanding documents in the portal", "tone": tone}


def explanation(context: dict) -> dict:
    items = [i for i in context["items"] if i["state"] != "verified"]
    items.sort(key=lambda i: (not i["mandatory"], i["doc_code"] not in context["customer_actionable"]))
    steps = []
    for i in items:
        customer = i["doc_code"] in context["customer_actionable"]
        reason = {"rejected": f"Rejected: {i.get('rejection_reason') or 'see notes'}",
                  "expired": "The document on file has expired.",
                  "pending": "The customer said it will follow.",
                  "missing": "Nothing has been received yet.",
                  "submitted": "Uploaded and waiting for staff verification.",
                  "needs_review": "The automatic match was uncertain; staff should check it."}[i["state"]]
        steps.append({"doc_code": i["doc_code"], "owner": "customer" if customer else "officer",
                      "action": ("Provide " if customer else "Review ") + i["name"].lower(), "reason": reason})
    today = context.get("today")
    due = context.get("due_date")
    blocked = [s for s in steps if s["owner"] == "customer"]
    risk = "low"
    if (due and today and due < today) or any(i["state"] in ("rejected", "expired") and i["mandatory"] for i in items):
        risk = "high"
    elif blocked and due and today and (date.fromisoformat(due) - date.fromisoformat(today)).days <= 7:
        risk = "medium"
    return {
        "summary": (f"{context['mandatory_verified']} of {context['mandatory_total']} mandatory items are verified. "
                    f"{len(blocked)} item(s) are waiting on the customer and "
                    f"{len(steps) - len(blocked)} on staff."),
        "steps": steps,
        "risk_level": risk,
        "risk_reason": {"high": "The due date has passed or a mandatory item was rejected/expired.",
                        "medium": "The due date is within 7 days and items are still outstanding.",
                        "low": "There is time before the due date."}[risk],
        "officer_next_action": ("Verify the submitted documents." if len(steps) > len(blocked)
                                else "Send the customer a reminder for the outstanding items.") if steps
        else "All items verified – complete the onboarding.",
    }
