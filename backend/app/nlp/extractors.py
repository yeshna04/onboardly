"""Rule-based entity extraction, submitted/pending cues and intent classification."""
from __future__ import annotations

import re
from datetime import date

from .preprocess import EMAIL_RE, ID_NUMBER_RE, PHONE_RE

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})
MONTHS["sept"] = 9

_ISO_DATE = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
_DMY = re.compile(r"\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b")
_DAY_MONTH_YEAR = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(" + "|".join(MONTHS) + r")\.?,?\s+(20\d{2})\b", re.I)
_MONTH_YEAR = re.compile(r"\b(" + "|".join(MONTHS) + r")\.?\s+(20\d{2})\b", re.I)
_RELATIVE = re.compile(r"\b(today|tomorrow|tonight|next week|next month|this weekend|this week|end of (?:the )?"
                       r"(?:week|month)|in \d+ days?|within \d+ days?|asap)\b", re.I)
_FILENAME = re.compile(r"\b[\w\-]+\.(?:pdf|jpe?g|png|docx?|txt|csv|json|heic)\b", re.I)
_MONEY = re.compile(r"(?:[$£€₹]|\b(?:usd|gbp|eur|inr|rs\.?)\s?)\s?\d[\d,]*(?:\.\d{1,2})?\b", re.I)
_TEST_SCORE = re.compile(r"\b(ielts|toefl|pte|duolingo)\b[^.\n]{0,25}?\b(\d{1,3}(?:\.\d)?)\b", re.I)

SUBMITTED_CUES = re.compile(
    r"\b(attach(?:ed|ing)?|enclos(?:ed|ing)|here(?:'s| is| are)|sharing|shared|sending|sent|upload(?:ed|ing)|"
    r"submit(?:ted|ting)?|providing|find (?:attached|enclosed)|included|paid|signed)\b", re.I)
PENDING_CUES = re.compile(
    r"\b(will (?:send|share|upload|submit|pay|sign|provide|forward|get)|i'll (?:send|share|upload|submit|pay|sign)|"
    r"to follow|later|next week|next month|not (?:yet|taken|received|available)|haven'?t|have not|"
    r"don'?t have|do not have|waiting (?:for|on)|pending|booked|after (?:my|the|i)|once (?:i|my|we)|"
    r"this weekend|soon|still need|need to get)\b", re.I)

INTENT_RULES: list[tuple[str, re.Pattern]] = [
    ("unsupported", re.compile(r"\b(refund|money back|chargeback|cancel (?:my )?(?:payment|subscription)|"
                               r"lawsuit|legal action|guarantee(?:d)? (?:visa|admission|job)|change my grade|"
                               r"issue (?:my )?certificate|password reset|hack)\b", re.I)),
    ("deadline_extension", re.compile(r"\b(extension|extend|more time|postpone|delay(?:ed)?|late submission)\b", re.I)),
    ("ask_requirements", re.compile(r"\b(what (?:documents|docs|do you need)|which documents|requirements?|"
                                    r"what else|do i need|is it (?:mandatory|required))\b", re.I)),
    ("status_query", re.compile(r"\b(status|when will|update on|verified\??|approved\??|any news|"
                                r"how long|check(?:ed)? my)\b", re.I)),
    ("submit_documents", re.compile(r"\b(attach(?:ed|ing)?|enclos(?:ed|ing)|upload(?:ed|ing)?|sending|here is|"
                                    r"here are|sharing|find attached)\b", re.I)),
    ("enrol", re.compile(r"\b(enrol(?:l)?(?:ing|ed)?|sign(?:ing)? up|register(?:ing)?|join(?:ing)?|apply(?:ing)?|"
                         r"interested in)\b", re.I)),
]

INTENT_LABELS = {
    "unsupported": "Unsupported request (outside onboarding)",
    "deadline_extension": "Asks for more time",
    "ask_requirements": "Asks what is required",
    "status_query": "Asks about status",
    "submit_documents": "Submitting documents",
    "enrol": "Wants to enrol",
    "general": "General message",
}


def _month(name: str) -> int:
    name = name.lower().rstrip(".")
    return MONTHS.get(name) or MONTHS[name[:3]]


def _safe_date(y: int, m: int, d: int) -> str | None:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def extract_dates(text: str) -> list[dict]:
    found: list[dict] = []
    for m in _ISO_DATE.finditer(text):
        iso = _safe_date(int(m[1]), int(m[2]), int(m[3]))
        if iso:
            found.append({"text": m[0], "iso": iso, "kind": "absolute"})
    for m in _DMY.finditer(text):
        iso = _safe_date(int(m[3]), int(m[2]), int(m[1]))  # day/month/year (international format)
        if iso:
            found.append({"text": m[0], "iso": iso, "kind": "absolute"})
    for m in _DAY_MONTH_YEAR.finditer(text):
        iso = _safe_date(int(m[3]), _month(m[2]), int(m[1]))
        if iso:
            found.append({"text": m[0], "iso": iso, "kind": "absolute"})
    covered = " ".join(f["text"] for f in found)
    for m in _MONTH_YEAR.finditer(text):
        if m[0] not in covered:
            found.append({"text": m[0], "iso": _safe_date(int(m[2]), _month(m[1]), 1), "kind": "month"})
    for m in _RELATIVE.finditer(text):
        found.append({"text": m[0], "iso": None, "kind": "relative"})
    return found


def extract_entities(text: str) -> dict:
    """Entities used for metadata and evidence. Personal identifiers are counted, never stored raw."""
    return {
        "dates": extract_dates(text),
        "filenames": sorted({m.lower() for m in _FILENAME.findall(text)}),
        "amounts": [m.group(0).strip() for m in _MONEY.finditer(text)],
        "test_scores": [{"test": m[1].upper(), "score": m[2]} for m in _TEST_SCORE.finditer(text)],
        "emails_found": len(EMAIL_RE.findall(text)),
        "phones_found": len(PHONE_RE.findall(text)),
        "id_numbers_found": len(ID_NUMBER_RE.findall(text)),
    }


def submission_cue(text: str) -> str | None:
    """'pending' beats 'submitted' when both appear ("will send the signed form")."""
    if PENDING_CUES.search(text):
        return "pending"
    if SUBMITTED_CUES.search(text):
        return "submitted"
    return None


def classify_intent(text: str) -> dict:
    scores: dict[str, int] = {}
    cues: dict[str, list[str]] = {}
    for label, pattern in INTENT_RULES:
        hits = [m.group(0).lower() for m in pattern.finditer(text)]
        if hits:
            scores[label] = len(hits)
            cues[label] = sorted(set(hits))[:5]
    if not scores:
        return {"label": "general", "display": INTENT_LABELS["general"], "confidence": 0.3, "cues": [],
                "all": {}}
    # Unsupported always wins – it must be routed to a human, not answered.
    order = [name for name, _ in INTENT_RULES]  # earlier rules win ties
    label = "unsupported" if "unsupported" in scores else max(scores, key=lambda k: (scores[k], -order.index(k)))
    total = sum(scores.values())
    return {"label": label, "display": INTENT_LABELS[label],
            "confidence": round(min(0.95, 0.5 + 0.5 * scores[label] / total), 2),
            "cues": cues[label], "all": scores}
