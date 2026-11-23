# Demo script (about 8–10 minutes)

This covers the brief's required demo: one normal scenario and one failure/recovery scenario,
plus the trace from NLP to API to database.

**Before recording:**
- Open the deployed URL (or `http://localhost:5050`) a minute early. Render's free tier needs about
  a minute to wake up.
- Have the officer login, a demo access code and the sample file `passport_scan.pdf` ready. Any small
  PDF renamed to that name works.

## 0. Intro (30 s)

"This is the Customer Onboarding Checklist Assistant. A learner picks a programme, the system builds
the checklist, NLP reads what they send, and an LLM explains what is outstanding and drafts
reminders. A human officer approves every message before the learner sees it."

## 1. Learner journey: normal scenario (3 min)

1. **Sign up** on the Learner tab, choose **Study-Abroad Pathway**, and point out:
   - the checklist is created straight away from the programme's required documents;
   - the due date (21 days) and the "Needed by …" tags.
2. **Upload** `passport_scan.pdf`. The NLP matches it to *Valid passport*, and the progress bar moves.
3. **Send a message**, e.g. "My IELTS is next Saturday, I'll upload the score after that."

## 2. Officer journey: NLP, then LLM, then human review (3 min)

1. Sign in on the **Staff** tab.
2. Show the **Dashboard**: enrolments by status and the documents waiting for verification.
3. Open the new learner's enrolment:
   - Point out that the message was analysed (intent, IELTS cue `pending`).
   - In **Verification**, verify the passport.
4. Click **Explain outstanding**, enter the demo access code, and point out:
   - this is a real Gemini/Claude call;
   - the pipeline steps with their timings;
   - the output is grounded: only real checklist items, the real due date, and who must act.
5. Click **Draft reminder** (friendly, portal). In **Reviews**, edit a sentence and click **Publish**.
6. Switch to the learner tab. The message is in **Messages**, and the bell shows a notification.
7. Open **Trace** for the enrolment (`/admin/enrolments/<id>/trace`) and show:
   - the NLP extraction;
   - the checklist snapshot;
   - the exact prompt version, request and response;
   - provider, model, tokens, latency and request id;
   - the validation result and the saved draft and audit rows.
8. On the same Trace page, scroll to the audit entries, including `draft.published` with the human edit diff.

## 3. Failure and recovery scenario (2 min)

Pick one:

- **API failure:** locally, set an invalid `GEMINI_API_KEY` in `backend/.env` and restart. On Render,
  change it under **Environment**; it redeploys automatically. Click **Draft reminder**. The trace
  shows the API step in red, and the result is a grounded template labelled **"Template – not AI"**,
  with the error stored. Nothing reaches the learner until it is published.
- **Bad input:**
  - Upload an unsupported file type (e.g. `.exe`) or a file over 5 MB, and show the clear error.
  - Or, in the **New enrolment** wizard, paste a refund request into the customer-email box. The NLP
    flags it as **unsupported** and asks for a human; the assistant does not act on it.

## 4. Wrap-up (30 s)

- **Tests:** 29 automated tests (`python -m unittest -v`), with mocked LLMs and edge cases.
- **Data:** synthetic only; API keys are in environment variables; nothing is sent without approval.
- **Links:** the GitHub repository and the deployed link.
