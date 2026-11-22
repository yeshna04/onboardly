# Sample end-to-end run (real Gemini API call)

This is one complete scenario, traced from the intake email through the NLP result, the API request
and response, and validation, to the database rows. All values are copied from the local database,
`llm_interactions` row **#7**, recorded on 22 Nov 2026. The learner is synthetic (see
`backend/data/sample/`).

**To see the same trace in the app:** go to Admin → Enrolments → **ENR-2026-0009** → **Trace**
(`/admin/enrolments/9/trace`).

## 1. Input: the enrolment and the customer's intake email

| Field | Value |
|---|---|
| Enrolment | `ENR-2026-0009`, Study-Abroad Pathway (`SAP`), status `awaiting_docs`, due `2026-12-10` |
| Intake text | "Hi, my daughter and I would like to know about the study abroad pathway. Sharing my passport copy and her 12th grade marksheet. English test not taken yet." |

## 2. NLP result (`nlp_extractions` #9, pipeline `nlp-1.2`)

| Output | Value |
|---|---|
| Tokens (stop-words removed) | `daughter, like, know, study, abroad, pathway, sharing, passport, copy, 12th, grade, marksheet, english, test, not, taken, yet` |
| Detected service (TF-IDF + phrase match) | **SAP – Study-Abroad Pathway**, score 0.779 (all other programmes 0.0), terms `pathway`, `study abroad` |
| Intent | `submit_documents` |
| Document matches | `PASSPORT` 0.785, cue **submitted** ("Sharing my passport copy") · `TRANSCRIPT`, cue **submitted** ("12th grade marksheet") · `ENGLISH_TEST` 0.792, cue **pending** ("English test not taken yet") |
| Personal data found | 0 emails, 0 phones, 0 ID numbers |

## 3. Checklist comparison (`onboarding_checks` #21, trigger `ai_draft_reminder`)

6 mandatory items: 2 collected, 0 verified, 33.3 % complete.

| doc_code | State | Who acts |
|---|---|---|
| PASSPORT | submitted | staff |
| TRANSCRIPT | submitted | staff |
| ENGLISH_TEST | missing | customer |
| PHOTO | missing | customer |
| FEE_RECEIPT | missing | customer |
| CONSENT_FORM | missing | customer |

## 4. API request (stored PII-masked in `llm_interactions.request_json`)

```json
{"provider": "gemini", "model": "gemini-3.5-flash", "effort": "low", "prompt_version": "v2",
 "tone": "friendly", "channel": "portal", "schema": "draft_reminder"}
```

- **System prompt:** `prompts/v2/system.md`.
- **User prompt:** `prompts/v2/draft_reminder.md`, with the checklist above inserted as JSON in
  `<onboarding_context>`.
- **Output format:** `responseSchema` = the reminder JSON schema.
- **Request settings:** a 45 s timeout and 2 retries.

## 5. API response (`llm_interactions` #7)

| Field | Value |
|---|---|
| provider / model | `gemini` / `gemini-3.6-flash` (the version the API reports serving) |
| status | `success`, 1 attempt, stop reason `STOP` |
| tokens | 1 723 in → 2 411 out (including thinking) |
| latency | 11 581 ms |
| request id | `F5cCa6iBJNnl4-EPmO6D8AQ` |

```json
{
  "subject": "Four items needed for your Study-Abroad Pathway",
  "body": "Hi Priya,\n\nThank you for submitting your valid passport and academic transcript — our team is currently reviewing them.\n\nTo complete your enrolment for the Study-Abroad Pathway, we still need:\n- English language test score: we understand you have not taken your test yet, so please upload your report once available.\n- Passport-size photo: please upload a recent colour photo on a plain background.\n- Fee payment receipt: please provide your deposit receipt or bank confirmation.\n- Signed learner agreement: please upload your signed and dated agreement.\n\nPlease upload these items through your onboarding portal by 10 December 2026.\n\nBest wishes,\nThe Onboarding Team",
  "mentioned_doc_codes": ["ENGLISH_TEST", "PHOTO", "FEE_RECEIPT", "CONSENT_FORM"],
  "call_to_action": "Upload your remaining onboarding documents through the portal",
  "tone": "friendly"
}
```

## 6. Validation and grounding

`validation_errors_json = {"errors": [], "warnings": []}`:

- **Only real items:** the four requested codes are exactly the customer-actionable items. The passport
  and transcript are thanked for, not asked for again.
- **NLP evidence used:** the reminder acknowledges "you have not taken your test yet".
- **Dates:** the only date is the real due date, 10 December 2026.
- **Safe content:** no links, no contact details, no promises.

## 7. Saved records

| Table | Row |
|---|---|
| `llm_interactions` | #7 (above) |
| `reminder_drafts` | #4: channel `portal`, status **`draft`**, `is_fallback = 0`, not reviewed, not published |
| `audit_log` | #78 `ai.draft_reminder`: `{"model": "gemini-3.6-flash", "status": "success", "fallback": false, "draft_id": 4, "errors": []}` |

The draft stays in **Admin → Reviews** until an officer edits and publishes it. Only then is a
`messages` row created for the customer, plus an audit row `draft.published` with the edit diff.

## Failure-recovery scenario

The same pipeline with an API failure is covered by automated tests (see `TEST_EVIDENCE.md`):

- **TC22:** two ungrounded replies. A repair request is sent once, then a labelled template is used and
  `status = validation_failed` is stored.
- **TC23:** a provider timeout. The template explanation is used and `status = timeout` is stored with
  the error message.

To see it live: remove `GEMINI_API_KEY` (or set an invalid one), restart, and click **Draft
reminder**. The trace shows the API step in red and a "Template – not AI" draft.
