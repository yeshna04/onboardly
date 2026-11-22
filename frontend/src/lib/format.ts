export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const d = parseDate(v);
  return d ? d.toLocaleDateString("en-GB", opts) : "—";
}

export function fmtDateTime(v: string | null | undefined) {
  const d = parseDate(v);
  return d ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export function timeAgo(v: string | null | undefined) {
  const d = parseDate(v);
  if (!d) return "—";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const dd = Math.round(h / 24); if (dd < 30) return `${dd}d ago`;
  return fmtDate(v);
}

/** Days until a YYYY-MM-DD date (negative = overdue). */
export function daysUntil(v: string | null | undefined): number | null {
  const d = parseDate(v);
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function dueLabel(v: string | null | undefined) {
  const n = daysUntil(v);
  if (n === null) return null;
  if (n < 0) return { text: `${-n}d overdue`, tone: "rose" as const };
  if (n === 0) return { text: "Due today", tone: "amber" as const };
  if (n <= 7) return { text: `Due in ${n}d`, tone: "amber" as const };
  return { text: `Due ${fmtDate(v, { day: "numeric", month: "short" })}`, tone: "slate" as const };
}

export function fileSize(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export const STATUS_LABEL: Record<string, string> = {
  new: "New", awaiting_docs: "Awaiting docs", ready_for_review: "Ready for review", completed: "Completed", cancelled: "Cancelled",
};

export const INTENT_LABEL: Record<string, string> = {
  unsupported: "Out of scope", deadline_extension: "Asks for more time", ask_requirements: "Asks requirements",
  status_query: "Status question", submit_documents: "Sending documents", enrol: "Wants to enrol", general: "General",
};
