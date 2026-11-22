import { AlertTriangle, CheckCircle2, Circle, Clock, Eye, FileUp, MessageSquareText, RotateCcw, ShieldCheck, User, XCircle } from "lucide-react";
import type { DocState, EnrolmentStatus } from "../lib/types";
import { INTENT_LABEL, STATUS_LABEL } from "../lib/format";
import { Badge, type Tone } from "./ui";

export const STATUS_TONE: Record<EnrolmentStatus, Tone> = {
  new: "slate", awaiting_docs: "amber", ready_for_review: "sky", completed: "emerald", cancelled: "rose",
};

export function StatusPill({ status }: { status: EnrolmentStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status] ?? status}</Badge>;
}

export const DOC_STATE: Record<DocState, { tone: Tone; label: string; customer: string; Icon: typeof Circle }> = {
  verified: { tone: "emerald", label: "Verified", customer: "Verified", Icon: CheckCircle2 },
  submitted: { tone: "sky", label: "Submitted", customer: "With our team", Icon: Eye },
  needs_review: { tone: "violet", label: "Needs review", customer: "Being checked", Icon: Eye },
  pending: { tone: "amber", label: "Promised", customer: "You said it's coming", Icon: Clock },
  rejected: { tone: "rose", label: "Rejected", customer: "Needs a new copy", Icon: XCircle },
  expired: { tone: "rose", label: "Expired", customer: "Expired", Icon: RotateCcw },
  missing: { tone: "slate", label: "Missing", customer: "To upload", Icon: FileUp },
};

export function DocStatePill({ state, customer }: { state: DocState; customer?: boolean }) {
  const s = DOC_STATE[state];
  return <Badge tone={s.tone} icon={<s.Icon className="h-3.5 w-3.5" />}>{customer ? s.customer : s.label}</Badge>;
}

export function DocStateIcon({ state, className = "h-5 w-5" }: { state: DocState; className?: string }) {
  const s = DOC_STATE[state];
  const color = { emerald: "text-emerald-500", sky: "text-sky-500", violet: "text-violet-500", amber: "text-amber-500", rose: "text-rose-500", slate: "text-stone-300 dark:text-stone-600", brand: "text-brand-500" }[s.tone];
  return <s.Icon className={`${className} ${color}`} />;
}

const INTENT_TONE: Record<string, Tone> = {
  unsupported: "rose", deadline_extension: "amber", ask_requirements: "sky", status_query: "violet", submit_documents: "emerald", enrol: "brand", general: "slate",
};
export function IntentPill({ intent }: { intent: string | null | undefined }) {
  if (!intent) return null;
  return <Badge tone={INTENT_TONE[intent] ?? "slate"} icon={intent === "unsupported" ? <AlertTriangle className="h-3 w-3" /> : undefined}>{INTENT_LABEL[intent] ?? intent}</Badge>;
}

/**
 * Who put this document on the checklist. Staff uploads are always labelled so nobody mistakes
 * them for something the customer sent themselves.
 */
export function UploaderBadge({ role, name, channel, audience = "staff" }: {
  role?: string | null; name?: string | null; channel?: string | null; audience?: "staff" | "customer";
}) {
  const byStaff = role === "admin";
  if (audience === "customer") {
    if (!byStaff) return null;
    return <Badge tone="violet" className="!py-0.5"><ShieldCheck className="h-3 w-3" />Added by your onboarding team</Badge>;
  }
  if (channel === "pasted_text") {
    return <Badge tone="sky" className="!py-0.5"><MessageSquareText className="h-3 w-3" />From customer's message{byStaff && name ? ` · logged by ${name}` : ""}</Badge>;
  }
  if (byStaff) return <Badge tone="violet" className="!py-0.5"><ShieldCheck className="h-3 w-3" />Uploaded by staff{name ? ` · ${name}` : ""}</Badge>;
  if (channel === "upload" || role === "customer") return <Badge className="!py-0.5"><User className="h-3 w-3" />Uploaded by customer</Badge>;
  return null;
}
