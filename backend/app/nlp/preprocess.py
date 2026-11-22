"""Text cleaning, PII masking, segmentation and tokenisation."""
from __future__ import annotations

import html
import re
import unicodedata

STOPWORDS = frozenset("""
a about above after again all am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers herself
him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only
or other our ours ourselves out over own same she should so some such than that the their theirs them themselves
then there these they this those through to too under until up very was we were what when where which while who
whom why will with would you your yours yourself yourselves hi hello hey dear thanks thank regards team please
kind best cheers also im ive ill id dont cant wont get got just one us
""".split())

# Words that matter for cue detection must survive stop-word removal.
KEEP_WORDS = frozenset({"not", "no", "will", "later", "yet", "after", "once"})

_HTML_TAG = re.compile(r"<[^>]+>")
_QUOTED_LINE = re.compile(r"^\s*>.*$", re.MULTILINE)
_REPLY_HEADER = re.compile(r"^\s*On .{5,120}wrote:\s*$", re.MULTILINE | re.IGNORECASE)
_SIGNATURE = re.compile(r"\n--\s*\n.*\Z", re.DOTALL)
_WS = re.compile(r"[ \t\f\v]+")
_MULTI_NL = re.compile(r"\n{3,}")
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]")

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Phone numbers – but never ISO dates such as 2026-11-20.
PHONE_RE = re.compile(r"(?<![\w])(?!\d{4}-\d{1,2}-\d{1,2}(?![\d]))(?:\+?\d[\d ()-]{7,}\d)(?![\w])")
ID_NUMBER_RE = re.compile(r"\b(?:[A-Z]{1,3}\d{6,10}|\d{4}[ -]?\d{4}[ -]?\d{4})\b")

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])|\n+")
_CLAUSE_SPLIT = re.compile(r"\s*(?:,|;|:|\band\b|\bplus\b|\balso\b|\bbut\b|&)\s*", re.IGNORECASE)
_TOKEN = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def clean_text(text: str) -> str:
    """Normalise unicode, strip HTML, quoted replies, signatures and emoji; tidy whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = html.unescape(_HTML_TAG.sub(" ", text))
    text = _REPLY_HEADER.split(text)[0]          # drop everything below "On ... wrote:"
    text = _QUOTED_LINE.sub("", text)
    text = _SIGNATURE.sub("", text)
    text = _EMOJI.sub(" ", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _MULTI_NL.sub("\n\n", text).strip()
    # Shouting is common in customer emails; lower-case all-caps sentences for readability.
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        text = text.lower()
    return text


def mask_pii(text: str) -> str:
    """Replace emails, phone numbers and ID-like numbers before text is stored or sent to the LLM."""
    text = EMAIL_RE.sub("[EMAIL]", text)
    text = ID_NUMBER_RE.sub("[ID_NUMBER]", text)
    text = PHONE_RE.sub("[PHONE]", text)
    return text


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s and s.strip()]


def split_clauses(sentence: str) -> list[str]:
    parts = [p.strip(" .!?-") for p in _CLAUSE_SPLIT.split(sentence)]
    return [p for p in parts if len(p) >= 2]


def light_stem(token: str) -> str:
    """Very small suffix stripper so 'receipts'→'receipt', 'certificates'→'certificate'."""
    for suffix, min_len in (("ies", 5), ("es", 6), ("s", 4)):
        if token.endswith(suffix) and len(token) >= min_len and not token.endswith("ss"):
            return token[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return token


def tokenize(text: str, *, remove_stopwords: bool = True, stem: bool = True) -> list[str]:
    tokens = _TOKEN.findall(text.lower().replace("’", "'"))
    out = []
    for t in tokens:
        t = t.replace("'", "")
        if remove_stopwords and t in STOPWORDS and t not in KEEP_WORDS:
            continue
        out.append(light_stem(t) if stem else t)
    return out


def filename_to_text(filename: str) -> str:
    """'aria_passport-scan2026.PDF' → 'aria passport scan 2026'."""
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    stem = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem)
    stem = re.sub(r"[_\-.()+\[\]]+", " ", stem)
    stem = re.sub(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", stem)
    return re.sub(r"\s+", " ", stem).strip().lower()
