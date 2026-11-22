"""Standard-library NLP pipeline for onboarding text.

Modules
  preprocess  – cleaning, PII masking, sentence/clause splitting, tokenisation
  tfidf       – a small TF-IDF vectoriser + cosine similarity (written from scratch)
  extractors  – entity extraction, submitted/pending cues, intent classification
  pipeline    – the public entry points used by the app (analyze_text, classify_upload)
"""
PIPELINE_VERSION = "nlp-1.2"
