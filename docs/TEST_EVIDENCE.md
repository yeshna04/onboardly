# Test evidence

**29 automated tests, all passing.** They use Python `unittest` only, with no extra packages. The LLM
providers are mocked, so the tests need no API key, no network and no credits. Each test runs on
its own throw-away copy of a freshly seeded synthetic database. Your real `db/onboarding.db` and
`.env` are never touched.

```bash
cd backend
.venv/bin/python -m unittest -v
```

Raw output of the latest run: [`test-run.txt`](test-run.txt). The test code is in
[`backend/tests/`](../backend/tests/).

## Test cases

| ID | Area | Type | Input | Expected | Actual |
|---|---|---|---|---|---|
| TC01 | NLP | normal | Intake email: "…Study-Abroad Pathway… attached my passport scan and my school transcript. My IELTS test is booked so I will send the score next week." | Service `SAP`; PASSPORT and TRANSCRIPT cue `submitted`; ENGLISH_TEST cue `pending`; no warnings | ✅ as expected |
| TC02 | NLP | edge: empty input | `"   \n\t  "` | No matches, no service, warning "Text was empty after cleaning." | ✅ |
| TC03 | NLP | edge: unsupported request | "I want a refund of my deposit please, cancel everything." | Intent `unsupported` + "Route it to a human" warning | ✅ |
| TC04 | NLP | edge: malformed text | `"@@## ~~ qwzx ??? 12345 ////"` | No document matches, no service | ✅ |
| TC05 | NLP | privacy | Text with an email and a phone number | Both masked | ✅ |
| TC06 | NLP | normal | Upload named `passport_scan.pdf` | Suggested item `PASSPORT` | ✅ |
| TC07 | NLP | normal | "Due 2026-12-13, exam on 5 January 2027, I'll send it next week." | `2026-12-13`, `2027-01-05` + one relative date | ✅ |
| TC08 | Checklist | normal | 3 mandatory docs: 1 verified, 1 rejected ("Blurry scan"), 1 missing | 1/3 verified; outstanding = TRANSCRIPT rejected, ENGLISH_TEST missing; next step "Re-upload your transcript – Blurry scan" | ✅ |
| TC09 | Checklist | edge: old document and status | Verified English test dated 2019-01-01; then all mandatory items submitted | Still `verified` (no expiry rule); `new` stays `new` (shown as "Enrolled"); `ready_for_review`; a cancelled enrolment stays `cancelled` | ✅ |
| TC10 | Validation | edge: bad input | `not-an-email`, `password`, `abc1`, `2026-02-30` | `ValidationError` with field messages; email is normalised to lower case | ✅ |
| TC11 | CRM connector (pandas) | edge: malformed file | `crm_export_with_errors.csv` (missing name, bad email, bad phone, duplicates) | Valid rows imported; bad rows reported with row and field; counts add up; one `crm.import` audit row | ✅ |
| TC12 | LLM validator | normal | Reminder naming only ENGLISH_TEST and the real due date | No errors | ✅ |
| TC13 | LLM validator | edge: hallucination | Reminder asking for a "VISA letter" by 1 March 2027, with a link, "guaranteed" and `[Officer Name]` | Errors: unknown doc, required item missing, invented date, link, promise, placeholder | ✅ |
| TC14 | LLM validator | edge | Explanation re-asking for verified PASSPORT, skipping ENGLISH_TEST, `risk_level: "extreme"` | 3 errors; the template explanation for the same context passes | ✅ |
| TC15 | Prompt pack | normal + edge | Render `draft_reminder` v2; unknown task `grade_learner`; unknown version `v9` | Versions `v1, v2`; context inserted; unknown task/version → `ValidationError` | ✅ |
| TC16 | Claude client (mocked SDK) | normal | JSON reply from `messages.create` | Parsed; model, tokens, request id kept; `json_schema` output format requested | ✅ |
| TC17 | Claude client (mocked SDK) | **API failure** | Timeout; 401 auth error; plain-text (non-JSON) reply | `timeout`, `api_error` (mentions 401) and `validation_failed`, with no exception raised | ✅ |
| TC18 | Claude client | edge: no key | No `ANTHROPIC_API_KEY` | `not_configured`, no network call | ✅ |
| TC19 | Gemini client (mocked HTTP) | recovery | 503, then 200 | Retried once; success; model, tokens and 2 attempts recorded | ✅ |
| TC20 | Gemini client (mocked HTTP) | **API failure** | 429 every time | `api_error` with a readable quota message | ✅ |
| TC21 | **End-to-end workflow** | normal | Open enrolment + mocked grounded LLM reply | 7 pipeline steps; `llm_interactions` row with provider, model, tokens, request id, prompt v2; draft saved as `draft`; no customer message; audit row | ✅ |
| TC22 | End-to-end workflow | **failure recovery** | LLM returns an ungrounded reply twice | One repair request listing the errors, then a template draft (`is_fallback = 1`), with status `validation_failed` and the errors stored | ✅ |
| TC23 | End-to-end workflow | **API failure** | Provider timeout | Template explanation with a valid risk level; status `timeout` and the error stored | ✅ |
| TC24 | End-to-end workflow | edge: no matching record / unsupported | Enrolment `999999`; reminder for a completed enrolment | `NotFoundError`; `UnsupportedRequestError`, and the LLM is never called | ✅ |
| TC25 | API | security | Health check; wrong password; learner opening the admin API; officer login | 200 ok; 401; 403; 200 | ✅ |
| TC26 | API | security: CSRF | POST without the `X-Requested-With` header | 403 | ✅ |
| TC27 | API | edge: demo account | Read-only demo learner uploads a file | 403 `demo_account` | ✅ |
| TC28 | API | **human review** | Officer drafts a reminder, then publishes it | Draft created (201) and the customer has no new message; after **Publish**, one message, draft `published`, audit `draft.published` | ✅ |
| TC29 | API | normal | Officer sends a chat message with text only; CSV report exported | Message stored with the default subject "Message from your onboarding team" (201); the CSV shows `Enrolled`, not `new` | ✅ |

## What the brief asked for

| Requirement | Covered by |
|---|---|
| At least 10 test cases | 29 |
| Normal cases | TC01, 06–08, 12, 15–16, 19, 21, 29 |
| Empty or missing input | TC02, TC18 |
| Malformed text | TC04, TC10, TC11, TC17 (non-JSON reply) |
| No matching record | TC24 |
| Unsupported request | TC03, TC24 |
| API failure | TC17, TC20, TC22, TC23 |
| LLM output validated and grounded | TC12–14, TC22 |
| Human review before anything reaches a customer | TC21, TC28 |

## Manual checks (UI)

These were checked by hand in the browser during development, against the seeded data:

| Scenario | Result |
|---|---|
| Learner signs up, picks a programme, and gets a checklist with a 21-day due date | Checklist and "Needed by …" tags shown |
| Learner uploads `passport_scan.pdf` | Auto-matched to Passport; status "Submitted" |
| Officer verifies or rejects with a reason | Learner sees "Verified" / "Rejected – please re-upload" with the reason |
| Officer clicks **Draft reminder** with a Gemini key | Real Gemini call; the trace shows every step; the draft goes to Reviews |
| Same action with no key | "Template – not AI" draft; the trace shows the API step failed |
| Demo learner tries to upload, message or enrol | "Create your account to continue" pop-up; the server returns 403 |
| Officer cancels an enrolment with a reason | Learner sees "Cancelled" with the reason |
