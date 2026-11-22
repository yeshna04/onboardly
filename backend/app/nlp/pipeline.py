"""Public NLP entry points.

analyze_text()     – intake emails / notes / customer replies:
                     clean → mask PII → sentences/clauses → tokens → entities → intent
                     → service detection (TF-IDF vs programme profiles)
                     → document matching (TF-IDF + keyword phrases + fuzzy typos) with
                       submitted / pending cues per clause → inline highlights
classify_upload()  – uploaded files: file name + customer note + text content → ranked
                     document-type suggestions with confidence.

Matching score for a text segment against a required document:
    score = 0.55 × tfidf_cosine + 0.45 × phrase_hit  (+0.10 multi-word phrase)
    phrase_hit = 1 for an exact keyword phrase, 0.80 for a fuzzy (typo) match
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

from . import PIPELINE_VERSION
from .extractors import classify_intent, extract_entities, submission_cue
from .preprocess import clean_text, filename_to_text, mask_pii, split_clauses, split_sentences, tokenize
from .tfidf import TfidfIndex

DEFAULT_MATCH_THRESHOLD = 0.35
DEFAULT_REVIEW_THRESHOLD = 0.60
FUZZY_RATIO = 0.84


@dataclass
class Hit:
    start: int
    end: int
    phrase: str
    key: str
    fuzzy: bool = False


def _keywords(doc: dict) -> list[str]:
    words = [k.strip().lower() for k in (doc.get("keywords") or "").split(",") if k.strip()]
    name = doc.get("name", "").lower()
    if name and name not in words:
        words.append(re.sub(r"[^\w\s'-]", " ", name).strip())
    return sorted(set(words), key=len, reverse=True)


def _profile(doc: dict) -> str:
    kws = ", ".join(_keywords(doc))
    return f"{doc['name']} {doc['name']} {kws} {kws}"


def _phrase_hits(text: str, docs_kw: dict[str, list[str]]) -> list[Hit]:
    """Exact keyword phrases (word-bounded) plus fuzzy single-word matches, with overlap suppression."""
    low = text.lower()
    hits: list[Hit] = []
    for key, kws in docs_kw.items():
        for kw in kws:
            pattern = r"(?<![a-z0-9])" + r"[\s_\-]+".join(map(re.escape, kw.split())) + r"(?:e?s)?(?![a-z0-9])"
            for m in re.finditer(pattern, low):
                hits.append(Hit(m.start(), m.end(), kw, key))
    # fuzzy single-word matches for typos (e.g. "pasport", "transcipt")
    covered = [(h.start, h.end) for h in hits]
    for m in re.finditer(r"[a-z]{5,}", low):
        if any(s <= m.start() < e for s, e in covered):
            continue
        word = m.group(0)
        for key, kws in docs_kw.items():
            for kw in kws:
                if " " not in kw and len(kw) >= 5 and word != kw and \
                        difflib.SequenceMatcher(None, word, kw).ratio() >= FUZZY_RATIO:
                    hits.append(Hit(m.start(), m.end(), kw, key, fuzzy=True))
                    break
    # drop a hit that sits inside a longer hit belonging to another document
    kept = []
    for h in hits:
        if any(o is not h and o.key != h.key and o.start <= h.start and h.end <= o.end and
               (o.end - o.start) > (h.end - h.start) for o in hits):
            continue
        kept.append(h)
    return kept


def _segment_scores(segment: str, index: TfidfIndex, docs_kw: dict[str, list[str]]) -> dict[str, dict]:
    cos = index.query(segment)
    hits = _phrase_hits(segment, docs_kw)
    out = {}
    for key in docs_kw:
        mine = [h for h in hits if h.key == key]
        exact = [h for h in mine if not h.fuzzy]
        phrase = 1.0 if exact else (0.8 if mine else 0.0)
        multi = 0.10 if any(" " in h.phrase for h in exact) else 0.0
        score = min(1.0, 0.55 * cos[key] + 0.45 * phrase + multi)
        out[key] = {"score": round(score, 3), "cosine": cos[key],
                    "terms": sorted({h.phrase for h in mine}), "fuzzy": bool(mine and not exact)}
    return out


def _sentence_spans(text: str) -> list[tuple[int, int]]:
    spans, start = [], 0
    for m in re.finditer(r"[.!?](?=\s)|\n+", text):
        spans.append((start, m.end()))
        start = m.end()
    spans.append((start, len(text)))
    return [(s, e) for s, e in spans if text[s:e].strip()]


def detect_service(text: str, programmes: list[dict]) -> dict:
    if not programmes or not text.strip():
        return {"code": None, "name": None, "score": 0.0, "ranking": []}
    profiles = {p["code"]: f"{p['name']} {p['name']} {p.get('keywords', '')} {p.get('description', '')}"
                for p in programmes}
    index = TfidfIndex(profiles)
    cos = index.query(text)
    kw = {p["code"]: [k.strip().lower() for k in (p.get("keywords") or "").split(",") if k.strip()]
                     + [p["name"].lower()] for p in programmes}
    hits = _phrase_hits(text, kw)
    ranking = []
    for p in programmes:
        mine = {h.phrase for h in hits if h.key == p["code"] and not h.fuzzy}
        score = min(1.0, 0.6 * cos[p["code"]] + (0.4 if mine else 0) + (0.15 if p["name"].lower() in mine else 0))
        ranking.append({"code": p["code"], "name": p["name"], "score": round(score, 3), "terms": sorted(mine)})
    ranking.sort(key=lambda r: r["score"], reverse=True)
    top = ranking[0]
    margin = top["score"] - (ranking[1]["score"] if len(ranking) > 1 else 0)
    detected = top["score"] >= 0.3 and margin >= 0.08
    return {"code": top["code"] if detected else None, "name": top["name"] if detected else None,
            "score": top["score"], "ranking": ranking[:4]}


def analyze_text(text: str, programme: dict | None, all_programmes: list[dict] | None = None, *,
                 match_threshold: float = DEFAULT_MATCH_THRESHOLD,
                 review_threshold: float = DEFAULT_REVIEW_THRESHOLD) -> dict:
    """Run the full pipeline. ``programme`` carries its ``documents`` list (the checklist template)."""
    original = text or ""
    cleaned = clean_text(original)
    sentences = split_sentences(cleaned)
    tokens = tokenize(cleaned)
    result = {
        "pipeline_version": PIPELINE_VERSION,
        "clean_text": cleaned,
        "masked_text": mask_pii(cleaned),
        "sentence_count": len(sentences),
        "tokens": tokens[:300],
        "token_count": len(tokens),
        "entities": extract_entities(cleaned),
        "intent": classify_intent(cleaned),
        "detected_service": detect_service(cleaned, all_programmes or []),
        "document_matches": [],
        "highlights": [],
        "warnings": [],
    }
    if not cleaned:
        result["warnings"].append("Text was empty after cleaning.")
        return result
    if programme is None:
        return result

    docs = {d["doc_code"]: d for d in programme.get("documents", [])}
    docs_kw = {code: _keywords(d) for code, d in docs.items()}
    index = TfidfIndex({code: _profile(d) for code, d in docs.items()})

    best: dict[str, dict] = {}
    for sentence in sentences:
        sentence_cue = submission_cue(sentence)
        clauses = split_clauses(sentence) or [sentence]
        for clause in clauses:
            scores = _segment_scores(clause, index, docs_kw)
            top = max((s["score"] for s in scores.values()), default=0)
            for code, s in scores.items():
                # keep only clear winners within a clause (avoids "passport-size photo" → passport)
                if s["score"] < match_threshold or s["score"] < 0.75 * top:
                    continue
                cue = submission_cue(clause) or sentence_cue or "mentioned"
                if code not in best or s["score"] > best[code]["score"]:
                    best[code] = {**s, "evidence": mask_pii(clause)[:200], "sentence": mask_pii(sentence)[:300],
                                  "cue": cue}

    for code, m in sorted(best.items(), key=lambda kv: kv[1]["score"], reverse=True):
        doc = docs[code]
        result["document_matches"].append({
            "doc_code": code, "name": doc["name"], "required_document_id": doc.get("id"),
            "is_mandatory": bool(doc.get("is_mandatory", 1)),
            "score": m["score"], "confidence": "high" if m["score"] >= review_threshold else "medium",
            "cue": m["cue"], "evidence": m["evidence"], "sentence": m["sentence"],
            "matched_terms": m["terms"], "fuzzy": m["fuzzy"],
        })

    # inline highlights on the ORIGINAL text so the UI can mark exactly what the user typed
    matched_codes = set(best)
    spans = _sentence_spans(original)
    for h in _phrase_hits(original, {c: docs_kw[c] for c in matched_codes}):
        sent = next((original[s:e] for s, e in spans if s <= h.start < e), original)
        result["highlights"].append({"start": h.start, "end": h.end, "text": original[h.start:h.end],
                                     "doc_code": h.key, "kind": "document",
                                     "cue": best[h.key]["cue"] if h.key in best else submission_cue(sent)})
    from .extractors import PENDING_CUES  # local import keeps the public surface small
    for m in PENDING_CUES.finditer(original):
        result["highlights"].append({"start": m.start(), "end": m.end(), "text": m.group(0),
                                     "doc_code": None, "kind": "pending_cue", "cue": "pending"})
    result["highlights"].sort(key=lambda h: h["start"])

    svc = result["detected_service"]
    if svc["code"] and programme.get("code") and svc["code"] != programme["code"]:
        result["warnings"].append(
            f"The text sounds like '{svc['name']}', but the selected programme is '{programme['name']}'.")
    if result["intent"]["label"] == "unsupported":
        result["warnings"].append("The message contains a request outside onboarding (e.g. refunds). "
                                  "Route it to a human; the assistant will not act on it.")
    return result


def classify_upload(filename: str, note: str | None, content_text: str | None, documents: list[dict], *,
                    review_threshold: float = DEFAULT_REVIEW_THRESHOLD) -> dict:
    """Suggest which checklist item an uploaded file is, from its metadata and (for text files) its content."""
    docs = {d["doc_code"]: d for d in documents}
    if not docs:
        return {"suggestions": [], "best": None}
    docs_kw = {code: _keywords(d) for code, d in docs.items()}
    index = TfidfIndex({code: _profile(d) for code, d in docs.items()})
    meta_text = " ".join(t for t in (filename_to_text(filename or ""), clean_text(note or "")) if t)
    meta = _segment_scores(meta_text, index, docs_kw) if meta_text else {}
    content = _segment_scores(clean_text(content_text)[:3000], index, docs_kw) if content_text else {}
    suggestions = []
    for code, doc in docs.items():
        m = meta.get(code, {"score": 0, "terms": []})
        c = content.get(code, {"score": 0, "terms": []})
        score = max(m["score"], 0.9 * c["score"])
        source = "file name / note" if m["score"] >= 0.9 * c["score"] else "file content"
        suggestions.append({"doc_code": code, "name": doc["name"], "required_document_id": doc.get("id"),
                            "score": round(score, 3), "source": source,
                            "matched_terms": sorted(set(m["terms"]) | set(c["terms"]))})
    suggestions.sort(key=lambda s: s["score"], reverse=True)
    best = suggestions[0] if suggestions[0]["score"] >= DEFAULT_MATCH_THRESHOLD else None
    if best:
        runner_up = suggestions[1]["score"] if len(suggestions) > 1 else 0
        margin = best["score"] - runner_up
        # a single clear keyword in the file name (e.g. "ielts") is strong evidence when nothing else competes
        clear = best["score"] >= review_threshold or (best["score"] >= 0.5 and margin >= 0.3)
        best = {**best, "confidence": "high" if clear and margin >= 0.1 else "medium"}
    return {"suggestions": suggestions[:4], "best": best, "input": mask_pii(meta_text)[:200],
            "entities": extract_entities(" ".join(filter(None, [note, (content_text or "")[:3000]]))),
            "pipeline_version": PIPELINE_VERSION}
