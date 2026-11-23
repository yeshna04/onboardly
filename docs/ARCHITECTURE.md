# Architecture and workflow

## Components

```mermaid
flowchart LR
  subgraph Browser["Browser – React + Vite + Tailwind"]
    CP["Customer portal<br/>checklist · uploads · messages"]
    AP["Admin portal<br/>enrolments · verification · AI assist · review queue · trace"]
  end

  subgraph Flask["Flask app (backend/app)"]
    R["routes/<br/>auth · portal · admin · public<br/>validation.py · security.py (CSRF, roles, rate limits)"]
    S["services/<br/>checklist · documents · ai_workflow · analytics"]
    N["nlp/<br/>preprocess → tf-idf → extractors → pipeline"]
    L["llm/<br/>context · prompts · client (Claude) · gemini_client<br/>validator · fallback"]
    REPO["repo/ – SQL per table (sqlite3)"]
    C["connectors/crm_import.py<br/>pandas CSV/JSON export"]
  end

  DB[("SQLite<br/>db/onboarding.db<br/>schema.sql")]
  FS[["uploads/ (files)"]]
  P["prompts/v1 · v2<br/>(prompt pack)"]
  API{{"LLM provider API<br/>Anthropic Claude or Google Gemini"}}
  CRM[/"CRM / LMS export<br/>(synthetic CSV / JSON)"/]

  CP & AP -->|"JSON /api/*  (session cookie + X-Requested-With)"| R
  R --> S
  S --> N
  S --> L
  S --> REPO --> DB
  S --> FS
  L --> P
  L -->|"HTTPS · structured JSON · timeout + retries"| API
  CRM -.->|"file upload / seed – connector boundary"| C --> REPO
```

**The connector boundary:** the app never talks to a real LMS or CRM. Customers come in through
`connectors/crm_import.py` from a CSV/JSON export, using the synthetic files in
`backend/data/sample/`. Swapping in an approved CRM API would only change this module.

## AI workflow ("Read enrolment → compare checklist → NLP → LLM → save status")

```mermaid
sequenceDiagram
  autonumber
  actor O as Onboarding officer
  participant W as services/ai_workflow.py
  participant DB as SQLite
  participant N as nlp/pipeline.py
  participant L as llm/ (prompt + client + validator)
  participant API as Claude / Gemini API

  O->>W: "Draft reminder" / "Explain outstanding"
  W->>DB: read enrolment + required_documents + document_submissions
  W->>DB: compare checklist → INSERT onboarding_checks, update enrolment status
  W->>N: analyse intake email / customer replies (if not yet done)
  N-->>DB: INSERT nlp_extractions (service, document matches, cues, intent, PII-masked)
  W->>L: build grounded context (checklist + masked customer quotes)
  L->>API: system + task prompt (prompts/v2), JSON schema, timeout, retries
  API-->>L: JSON
  L->>L: validate & ground (doc codes, dates, links, promises, placeholders)
  alt invalid
    L->>API: one repair request listing the errors
  end
  alt still invalid / timeout / no key
    L->>L: deterministic template (labelled "Template – not AI")
  end
  W->>DB: INSERT llm_interactions (provider, model, tokens, latency, request id, errors)
  W->>DB: INSERT reminder_drafts (status = draft) + audit_log
  W-->>O: result + per-step timings
  O->>DB: edit → Publish (or Reject) – the only way a message reaches the customer
```

## Data model (SQLite)

```mermaid
erDiagram
  customers ||--o{ enrolments : has
  customers ||--o| users : "portal login"
  programmes ||--o{ required_documents : requires
  programmes ||--o{ enrolments : "selected in"
  enrolments ||--o{ document_submissions : receives
  required_documents ||--o{ document_submissions : "matched to"
  enrolments ||--o{ onboarding_checks : "snapshots"
  enrolments ||--o{ nlp_extractions : analysed
  document_submissions ||--o| nlp_extractions : analysed
  enrolments ||--o{ llm_interactions : "AI calls"
  onboarding_checks ||--o{ llm_interactions : "context for"
  llm_interactions ||--o| reminder_drafts : produces
  reminder_drafts ||--o| messages : "published as"
  enrolments ||--o{ messages : inbox
  users ||--o{ notifications : receives
  enrolments ||--o{ invites : "portal invite"
```

`audit_log` is append-only (database triggers block UPDATE and DELETE) and has no foreign keys,
so audit rows outlive the records they describe. Every table has `created_at`; statuses are
enforced with `CHECK` constraints. The full schema is in [`backend/db/schema.sql`](../backend/db/schema.sql).

## Module map

| Folder | Responsibility |
|---|---|
| `app/routes/` | HTTP endpoints only: input validation, role checks, JSON in/out |
| `app/services/checklist.py` | Pure checklist comparison (required vs. submitted, best submission per item, status rules) |
| `app/services/documents.py` | Uploads (type and size checks), NLP classification, intake-text processing |
| `app/services/ai_workflow.py` | The 7-step AI pipeline above, with timings for the trace view |
| `app/nlp/` | Cleaning, tokenising and stemming; PII masking; TF-IDF cosine similarity; phrase/fuzzy matching; date, score and amount entities; submission cues; intent rules; service detection |
| `app/llm/` | Grounded context, versioned prompts, Claude SDK client, Gemini HTTP client, validator, template fallback |
| `app/repo/` | Small SQL helpers per table (CRUD) |
| `app/connectors/` | CRM/LMS export import with pandas (validation report, duplicates, audit) |
| `app/errors.py` | Typed exceptions → consistent JSON errors (`validation_error`, `not_found`, `unsupported_request`, …) |
