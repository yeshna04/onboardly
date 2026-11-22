"""A compact TF-IDF vectoriser and cosine similarity, written with the standard library.

Each "document" is a profile string (e.g. a required document's name plus its
keywords). Queries (sentences, file names, notes) are projected onto the same
vocabulary and compared with cosine similarity. Unigrams and bigrams are both
used so phrases such as "learner agreement" outweigh the single word "learner".
"""
from __future__ import annotations

import math
from collections import Counter

from .preprocess import tokenize


def ngrams(tokens: list[str], n_max: int = 2) -> list[str]:
    grams = list(tokens)
    for n in range(2, n_max + 1):
        grams += [" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]
    return grams


class TfidfIndex:
    def __init__(self, docs: dict[str, str], n_max: int = 2):
        """``docs`` maps a key (e.g. doc_code) to its profile text."""
        self.n_max = n_max
        self.keys = list(docs)
        tokenised = {k: ngrams(tokenize(t), n_max) for k, t in docs.items()}
        n_docs = len(tokenised) or 1
        df = Counter()
        for grams in tokenised.values():
            df.update(set(grams))
        # Smoothed IDF (as in scikit-learn): idf = ln((1+N)/(1+df)) + 1
        self.idf = {g: math.log((1 + n_docs) / (1 + c)) + 1.0 for g, c in df.items()}
        self.vectors = {k: self._vectorise(grams) for k, grams in tokenised.items()}

    def _vectorise(self, grams: list[str]) -> dict[str, float]:
        tf = Counter(g for g in grams if g in self.idf)
        vec = {g: (1 + math.log(c)) * self.idf[g] for g, c in tf.items()}  # sublinear tf
        norm = math.sqrt(sum(v * v for v in vec.values()))
        return {g: v / norm for g, v in vec.items()} if norm else {}

    def query(self, text: str) -> dict[str, float]:
        """Cosine similarity between ``text`` and every indexed document."""
        qv = self._vectorise(ngrams(tokenize(text), self.n_max))
        if not qv:
            return {k: 0.0 for k in self.keys}
        return {k: round(sum(w * dv.get(g, 0.0) for g, w in qv.items()), 4) for k, dv in self.vectors.items()}

    def shared_terms(self, text: str, key: str) -> list[str]:
        q = set(ngrams(tokenize(text), self.n_max))
        return sorted((g for g in q if g in self.vectors.get(key, {})), key=len, reverse=True)
