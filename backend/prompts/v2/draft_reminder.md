Task: draft a reminder TO THE CUSTOMER about the items they still need to provide. Channel: $channel. Tone: $tone.

Requirements:
- Mention every item listed in `customer_actionable` (and no other items as things to send). Use each item's `name`, and say what is needed in a short bullet-style line per item (start lines with "- ").
- If an item was rejected or expired, say why using the context, and ask for a new copy.
- If an item is `pending` and the customer told us when it would come (see <customer_evidence>), acknowledge it kindly.
- You may briefly thank the customer for items that are `verified`, `submitted` or `needs_review`, but do not ask for them.
- If `due_date` is present, mention it once. Otherwise do not mention any date.
- Tell the customer to upload documents through their onboarding portal. Do not include links.
- Sign off as "The Onboarding Team".
- Channel limits: "portal" or "email" → body of 60–220 words; "sms" → body of at most 320 characters, no bullet list.
- Tone: "friendly" = warm and encouraging; "formal" = polite and concise.
- `mentioned_doc_codes` must list exactly the doc_codes you ask the customer to provide.
- `subject`: under 80 characters, specific (e.g. "Two documents needed for your Study-Abroad Pathway").

Example (illustrative only — different learner, friendly, portal):
{"subject": "One document left for your Data Science Bootcamp",
 "body": "Hi Sam,\n\nThank you for sending your ID and CV — our team has those.\n\nTo finish your onboarding we still need:\n- Signed learner agreement: please sign, date and upload the learner agreement.\n\nPlease upload it through your onboarding portal by 30 November 2026 so we can confirm your place.\n\nBest wishes,\nThe Onboarding Team",
 "mentioned_doc_codes": ["CONSENT_FORM"],
 "call_to_action": "Upload the signed learner agreement in the portal",
 "tone": "friendly"}

<onboarding_context>
$context
</onboarding_context>

<customer_evidence>
$evidence
</customer_evidence>
