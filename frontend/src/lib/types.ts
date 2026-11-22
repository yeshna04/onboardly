export type Role = "admin" | "customer";
export interface User { id: number; email: string; full_name: string; role: Role; customer_id: number | null; is_demo?: boolean }

export type EnrolmentStatus = "new" | "awaiting_docs" | "ready_for_review" | "completed" | "cancelled";
export type DocState = "verified" | "submitted" | "needs_review" | "pending" | "rejected" | "expired" | "missing";

export interface RequiredDocument {
  id: number; programme_id: number; doc_code: string; name: string; description: string; why_needed: string;
  accepted_formats: string; keywords: string; is_mandatory: number; validity_days: number | null; sort_order: number;
}
export interface Programme {
  id: number; code: string; name: string; description: string; category: string; duration_weeks: number;
  keywords: string; is_active: number; documents: RequiredDocument[]; enrolment_count?: number;
}
export interface Enrolment {
  id: number; enrolment_ref: string; customer_id: number; programme_id: number; status: EnrolmentStatus;
  completion_pct: number; intake_text: string | null; detected_service_code: string | null; due_date: string | null;
  target_start_date: string | null; created_at: string; updated_at: string; completed_at: string | null;
  cancelled_at?: string | null; cancellation_reason?: string | null;
  customer_name: string; customer_email: string; customer_ref: string; country: string | null;
  programme_name: string; programme_code: string; programme_category: string;
  awaiting_verification?: number; needs_review?: number; pending_drafts?: number; source?: string;
}
export interface ChecklistItem {
  required_document_id: number; doc_code: string; name: string; description: string; why_needed: string;
  accepted_formats: string; is_mandatory: boolean; state: DocState; state_label: string; submission_id: number | null;
  filename: string | null; match_confidence?: number | null; rejection_reason: string | null; submitted_at: string | null;
  verified_at: string | null; expires_on: string | null; attempts: number;
}
export interface NextStep { kind: "upload" | "wait" | "done" | "cancelled"; title: string; detail: string; doc_code?: string; remaining: number }
export interface Checklist {
  items: ChecklistItem[]; required_count: number; collected_count: number; verified_count: number;
  completion_pct: number; verified_pct: number; outstanding: { doc_code: string; name: string; state: DocState; rejection_reason: string | null }[];
  needs_review: { doc_code: string; name: string }[]; all_collected: boolean; all_verified: boolean; next_step: NextStep;
}
export interface Submission {
  id: number; enrolment_id?: number; required_document_id: number | null; doc_code: string | null; document_name: string | null;
  channel?: string; original_filename: string | null; file_size: number | null; mime_type: string | null;
  customer_note: string | null; extracted_text?: string | null; detected_doc_code: string | null; match_confidence?: number | null;
  status: string; rejection_reason: string | null; created_at: string; verified_at: string | null; customer_confirmed: number;
  uploaded_by_name?: string; uploaded_by_role?: string; verified_by_name?: string; stored_path?: string | null; has_file?: boolean; added_by_staff?: boolean; from_message?: boolean;
  // queue extras
  enrolment_ref?: string; customer_name?: string; programme_name?: string;
}
export interface Message {
  id: number; enrolment_id: number; direction: "to_customer" | "from_customer"; subject: string; body: string;
  author_name: string | null; author_role: string | null; is_read: number; created_at: string; reminder_draft_id: number | null;
  nlp_intent?: string | null; enrolment_ref?: string; programme_name?: string; customer_name?: string;
}
export interface Draft {
  id: number; enrolment_id: number; channel: "portal" | "email" | "sms"; tone: "friendly" | "formal"; subject: string;
  body: string; original_body: string; is_fallback: number; status: "draft" | "published" | "rejected"; review_note: string | null;
  created_at: string; reviewed_at: string | null; published_at: string | null; enrolment_ref?: string; customer_name?: string;
  programme_name?: string; model?: string | null; provider?: string | null; llm_status?: string | null; latency_ms?: number | null;
  input_tokens?: number | null; output_tokens?: number | null; prompt_version?: string | null;
  validation?: { errors?: string[]; warnings?: string[] }; created_by_name?: string; reviewed_by_name?: string;
}
export interface Invite { id: number; code: string; email: string; status: string; expires_at: string }
export interface EnrolmentDetail {
  enrolment: Enrolment; checklist: Checklist; submissions: Submission[]; messages: Message[]; drafts: Draft[];
  invite: Invite | null; customer_has_login: boolean;
  checks: { id: number; completion_pct: number; status_before: string; status_after: string; trigger_reason: string; created_at: string }[];
}

export interface NlpMatch {
  doc_code: string; name: string; required_document_id: number; score: number; confidence: "high" | "medium";
  cue: "submitted" | "pending" | "mentioned"; evidence: string; sentence: string; matched_terms: string[]; fuzzy: boolean; is_mandatory: boolean;
}
export interface NlpHighlight { start: number; end: number; text: string; doc_code: string | null; kind: "document" | "pending_cue"; cue: string | null }
export interface NlpAnalysis {
  pipeline_version: string; clean_text: string; token_count: number; tokens: string[]; sentence_count: number;
  entities: { dates: { text: string; iso: string | null; kind: string }[]; filenames: string[]; amounts: string[]; test_scores: { test: string; score: string }[];
    emails_found: number; phones_found: number; id_numbers_found: number };
  intent: { label: string; display: string; confidence: number; cues: string[] };
  detected_service: { code: string | null; name: string | null; score: number; ranking: { code: string; name: string; score: number }[] };
  document_matches: NlpMatch[]; highlights: NlpHighlight[]; warnings: string[];
}

export interface AiStep { name: string; label: string; status: "ok" | "error"; detail: string | null; ms: number }
export interface AiResult {
  task: "explain_outstanding" | "draft_reminder"; is_fallback: boolean; steps: AiStep[];
  validation: { errors: string[]; warnings: string[] };
  interaction: { id: number; provider: string; model: string | null; status: string; error: string | null; input_tokens: number | null;
    output_tokens: number | null; latency_ms: number; attempts: number; request_id: string | null; prompt_version: string };
  draft_id: number | null;
  output: any;
}

export interface Notification { id: number; kind: string; title: string; body: string; link: string | null; is_read: number; created_at: string }
