-- =====================================================================
-- Project 040 – Customer Onboarding Checklist Assistant
-- SQLite schema (run with: python seed.py  — or  sqlite3 onboarding.db < schema.sql)
--
-- Conventions
--   * Every table has an INTEGER primary key and created_at / updated_at
--     timestamps stored as ISO-8601 UTC text.
--   * Status columns are constrained with CHECK (...) lists.
--   * Foreign keys are enforced (PRAGMA foreign_keys = ON is set per connection).
--   * JSON payloads (NLP output, LLM request/response, audit diffs) are stored as TEXT.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Customers (synthetic CRM mirror)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_ref    TEXT    NOT NULL UNIQUE,                 -- e.g. CUS-0001 (CRM key)
    full_name       TEXT    NOT NULL,
    email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    phone           TEXT,
    country         TEXT,
    status          TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive')),
    source          TEXT    NOT NULL DEFAULT 'admin'
                            CHECK (source IN ('admin', 'self_signup', 'crm_import', 'seed')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Users – login accounts for both portals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT    NOT NULL,
    full_name       TEXT    NOT NULL,
    role            TEXT    NOT NULL CHECK (role IN ('admin', 'customer')),
    customer_id     INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    -- shared demo logins (seeded synthetic learners): can look around but not change anything
    is_demo         INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    last_login_at   TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    -- a customer login must point at a customer record; admins must not
    CHECK ((role = 'customer' AND customer_id IS NOT NULL) OR
           (role = 'admin'    AND customer_id IS NULL))
);

-- ---------------------------------------------------------------------
-- Programmes (the "service" a customer selects)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programmes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,                 -- e.g. DSB
    name            TEXT    NOT NULL UNIQUE,
    description     TEXT    NOT NULL,
    category        TEXT    NOT NULL,
    duration_weeks  INTEGER NOT NULL CHECK (duration_weeks > 0),
    keywords        TEXT    NOT NULL DEFAULT '',             -- comma list used by NLP service detection
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Required documents per programme (the checklist template)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS required_documents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    programme_id     INTEGER NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
    doc_code         TEXT    NOT NULL,                       -- e.g. ID_PROOF
    name             TEXT    NOT NULL,
    description      TEXT    NOT NULL,                       -- shown to customers
    why_needed       TEXT    NOT NULL DEFAULT '',
    accepted_formats TEXT    NOT NULL DEFAULT 'pdf,jpg,png',
    keywords         TEXT    NOT NULL DEFAULT '',            -- comma list used by NLP matching
    is_mandatory     INTEGER NOT NULL DEFAULT 1 CHECK (is_mandatory IN (0, 1)),
    validity_days    INTEGER CHECK (validity_days IS NULL OR validity_days > 0),
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (programme_id, doc_code)
);

-- ---------------------------------------------------------------------
-- Enrolments – a customer on a programme
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrolments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_ref         TEXT    NOT NULL UNIQUE,           -- e.g. ENR-2026-0001
    customer_id           INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    programme_id          INTEGER NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
    status                TEXT    NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new', 'awaiting_docs', 'ready_for_review',
                                                    'completed', 'cancelled')),
    source                TEXT    NOT NULL DEFAULT 'admin'
                                  CHECK (source IN ('admin', 'self_service', 'invite', 'crm_import', 'seed')),
    completion_pct        REAL    NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
    intake_text           TEXT,                              -- free-text note/email captured at enrolment
    detected_service_code TEXT,                              -- NLP-detected programme code
    target_start_date     TEXT,
    due_date              TEXT,
    created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    completed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    completed_at          TEXT,
    cancelled_at          TEXT,
    cancellation_reason   TEXT,                              -- shown to the customer in their portal
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (customer_id, programme_id)
);

-- ---------------------------------------------------------------------
-- Invites – admin-created links that let a customer claim an enrolment
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,
    enrolment_id    INTEGER NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    email           TEXT    NOT NULL COLLATE NOCASE,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'revoked')),
    expires_at      TEXT    NOT NULL,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    accepted_at     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Document submissions – files / text a customer (or officer) provided
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_submissions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_id         INTEGER NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    required_document_id INTEGER REFERENCES required_documents(id) ON DELETE SET NULL, -- NULL = unclassified
    channel              TEXT    NOT NULL
                                 CHECK (channel IN ('upload', 'pasted_text', 'crm_import', 'seed')),
    original_filename    TEXT,
    stored_path          TEXT,
    mime_type            TEXT,
    file_size            INTEGER CHECK (file_size IS NULL OR file_size >= 0),
    customer_note        TEXT,
    extracted_text       TEXT,
    detected_doc_code    TEXT,
    match_confidence     REAL    CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),
    customer_confirmed   INTEGER NOT NULL DEFAULT 0 CHECK (customer_confirmed IN (0, 1)),
    status               TEXT    NOT NULL DEFAULT 'submitted'
                                 CHECK (status IN ('pending', 'submitted', 'needs_review',
                                                   'verified', 'rejected', 'superseded')),
    rejection_reason     TEXT,
    document_date        TEXT,                               -- date found on/for the document
    uploaded_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_at          TEXT,
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- NLP extractions – intermediate NLP results, kept for traceability
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nlp_extractions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_id          INTEGER REFERENCES enrolments(id) ON DELETE CASCADE,
    submission_id         INTEGER REFERENCES document_submissions(id) ON DELETE CASCADE,
    source_type           TEXT    NOT NULL
                                  CHECK (source_type IN ('intake_text', 'submission', 'customer_reply')),
    input_excerpt         TEXT    NOT NULL,                  -- PII-masked, truncated input
    clean_text            TEXT    NOT NULL,
    tokens_json           TEXT    NOT NULL DEFAULT '[]',
    entities_json         TEXT    NOT NULL DEFAULT '{}',
    detected_service_json TEXT    NOT NULL DEFAULT '{}',
    document_matches_json TEXT    NOT NULL DEFAULT '[]',
    intent                TEXT,
    pipeline_version      TEXT    NOT NULL,
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Onboarding checks – snapshot each time the checklist is compared
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_checks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_id     INTEGER NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    required_count   INTEGER NOT NULL,
    collected_count  INTEGER NOT NULL,
    verified_count   INTEGER NOT NULL,
    completion_pct   REAL    NOT NULL,
    checklist_json   TEXT    NOT NULL,                       -- full per-document result
    missing_json     TEXT    NOT NULL DEFAULT '[]',
    status_before    TEXT    NOT NULL,
    status_after     TEXT    NOT NULL,
    triggered_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    trigger_reason   TEXT    NOT NULL DEFAULT 'manual',
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- LLM interactions – every provider call (or fallback), with metadata
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_interactions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_id           INTEGER NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    check_id               INTEGER REFERENCES onboarding_checks(id) ON DELETE SET NULL,
    task                   TEXT    NOT NULL CHECK (task IN ('explain_outstanding', 'draft_reminder')),
    provider               TEXT    NOT NULL,                 -- 'anthropic' or 'template'
    model                  TEXT,
    prompt_version         TEXT    NOT NULL,
    request_json           TEXT    NOT NULL,                 -- PII-masked request payload
    response_text          TEXT,
    parsed_json            TEXT,
    input_tokens           INTEGER,
    output_tokens          INTEGER,
    latency_ms             INTEGER,
    request_id             TEXT,
    stop_reason            TEXT,
    attempts               INTEGER NOT NULL DEFAULT 1,
    status                 TEXT    NOT NULL
                                   CHECK (status IN ('success', 'validation_failed', 'api_error',
                                                     'timeout', 'not_configured', 'fallback')),
    error_message          TEXT,
    validation_errors_json TEXT    NOT NULL DEFAULT '[]',
    created_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Reminder drafts – AI (or template) drafts awaiting human review
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminder_drafts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_id       INTEGER NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    llm_interaction_id INTEGER REFERENCES llm_interactions(id) ON DELETE SET NULL,
    channel            TEXT    NOT NULL DEFAULT 'portal' CHECK (channel IN ('portal', 'email', 'sms')),
    tone               TEXT    NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly', 'formal')),
    subject            TEXT    NOT NULL,
    body               TEXT    NOT NULL,
    original_body      TEXT    NOT NULL,                     -- as generated, before human edits
    is_fallback        INTEGER NOT NULL DEFAULT 0 CHECK (is_fallback IN (0, 1)),
    status             TEXT    NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'published', 'rejected')),
    review_note        TEXT,
    reviewed_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at        TEXT,
    published_at       TEXT,
    created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Messages – customer portal inbox (published reminders + customer replies)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    enrolment_id      INTEGER NOT NULL REFERENCES enrolments(id) ON DELETE CASCADE,
    direction         TEXT    NOT NULL CHECK (direction IN ('to_customer', 'from_customer')),
    subject           TEXT    NOT NULL,
    body              TEXT    NOT NULL,
    reminder_draft_id INTEGER REFERENCES reminder_drafts(id) ON DELETE SET NULL,
    nlp_extraction_id INTEGER REFERENCES nlp_extractions(id) ON DELETE SET NULL,
    author_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_read           INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    read_at           TEXT,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Notifications – in-app bell for both portals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL DEFAULT '',
    link        TEXT,
    is_read     INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Audit log – append-only record of every consequential action
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    -- No FOREIGN KEY clauses on purpose: audit rows must outlive the records
    -- they describe, and the table is append-only (see triggers below).
    actor_user_id INTEGER,
    actor_role    TEXT    NOT NULL CHECK (actor_role IN ('admin', 'customer', 'system')),
    action        TEXT    NOT NULL,                          -- e.g. enrolment.created
    entity_type   TEXT    NOT NULL,
    entity_id     INTEGER,
    enrolment_id  INTEGER,
    details_json  TEXT    NOT NULL DEFAULT '{}',             -- before/after or context
    ip_address    TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------
-- Indexes for the common queries
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_customer          ON users(customer_id);
CREATE INDEX IF NOT EXISTS idx_reqdocs_programme       ON required_documents(programme_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_enrolments_status       ON enrolments(status);
CREATE INDEX IF NOT EXISTS idx_enrolments_customer     ON enrolments(customer_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_programme    ON enrolments(programme_id);
CREATE INDEX IF NOT EXISTS idx_invites_enrolment       ON invites(enrolment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_enrolment   ON document_submissions(enrolment_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_status      ON document_submissions(status);
CREATE INDEX IF NOT EXISTS idx_nlp_enrolment           ON nlp_extractions(enrolment_id);
CREATE INDEX IF NOT EXISTS idx_checks_enrolment        ON onboarding_checks(enrolment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_enrolment           ON llm_interactions(enrolment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_status           ON reminder_drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_enrolment        ON reminder_drafts(enrolment_id);
CREATE INDEX IF NOT EXISTS idx_messages_enrolment      ON messages(enrolment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user      ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_enrolment         ON audit_log(enrolment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created           ON audit_log(created_at);

-- ---------------------------------------------------------------------
-- updated_at maintenance triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_customers_updated AFTER UPDATE ON customers
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE customers SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_users_updated AFTER UPDATE ON users
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_programmes_updated AFTER UPDATE ON programmes
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE programmes SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_reqdocs_updated AFTER UPDATE ON required_documents
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE required_documents SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_enrolments_updated AFTER UPDATE ON enrolments
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE enrolments SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_invites_updated AFTER UPDATE ON invites
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE invites SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_submissions_updated AFTER UPDATE ON document_submissions
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE document_submissions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_drafts_updated AFTER UPDATE ON reminder_drafts
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE reminder_drafts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

-- The audit log is append-only.
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
