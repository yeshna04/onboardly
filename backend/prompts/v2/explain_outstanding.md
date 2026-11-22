Task: explain the outstanding onboarding steps to the OFFICER (internal note, not for the customer).

Produce:
- `summary`: 2–3 sentences. Say how many mandatory items are done, what is blocking completion, and whether anything is waiting on staff.
- `steps`: one entry per item that is not `verified` (mandatory items first, then optional). For each give the `doc_code`, the `owner` ("customer" or "officer" — see the state rules), a short imperative `action`, and a one-sentence `reason` grounded in the item's state, rejection reason, expiry or the customer's own words.
- `risk_level`: "high" if the due date has passed or a mandatory item was rejected/expired; "medium" if the due date is within 7 days of `today` and mandatory items are still with the customer; otherwise "low".
- `risk_reason`: one sentence justifying the risk level from the context.
- `officer_next_action`: the single most useful thing the officer should do next.

Example (illustrative only — different learner):
Context items: ID_PROOF verified; CV submitted; FEE_RECEIPT rejected ("Receipt is for a different course."); CONSENT_FORM missing. Due date passed.
Output:
{"summary": "1 of 4 mandatory items is verified. The fee receipt was rejected and the signed agreement has not arrived; the CV is waiting for staff verification.",
 "steps": [
  {"doc_code": "FEE_RECEIPT", "owner": "customer", "action": "Upload the receipt for this programme's fee", "reason": "The previous receipt was rejected because it was for a different course."},
  {"doc_code": "CONSENT_FORM", "owner": "customer", "action": "Sign and upload the learner agreement", "reason": "No agreement has been received yet."},
  {"doc_code": "CV", "owner": "officer", "action": "Verify the uploaded CV", "reason": "The CV was submitted and is waiting for staff review."}],
 "risk_level": "high", "risk_reason": "The due date has passed and a mandatory item was rejected.",
 "officer_next_action": "Verify the CV now and send the customer a reminder about the fee receipt and agreement."}

<onboarding_context>
$context
</onboarding_context>

<customer_evidence>
$evidence
</customer_evidence>

<recent_customer_messages>
$recent_messages
</recent_customer_messages>
