import clsx from "clsx";
import { AlarmClock, CalendarClock, CheckCircle2 } from "lucide-react";
import { daysUntil, fmtDate } from "../lib/format";
import type { EnrolmentStatus } from "../lib/types";

/**
 * Customer-facing wording for the document deadline (one date per enrolment).
 * Tone: calm when far away, amber within a week, rose once it has passed.
 */
export function deadlineInfo(due: string | null | undefined) {
  const n = daysUntil(due);
  if (n === null) return null;
  const date = fmtDate(due, { weekday: "short", day: "numeric", month: "short" });
  const left = n < 0 ? `${-n} day${n === -1 ? "" : "s"} overdue` : n === 0 ? "due today" : `${n} day${n === 1 ? "" : "s"} left`;
  const tone = n < 0 ? "rose" : n <= 7 ? "amber" : "brand";
  return { n, date, left, tone } as const;
}

const TONE = {
  brand: "border-brand-200 bg-brand-50/80 text-brand-900 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-100",
  amber: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100",
  rose: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100",
};
const CHIP = {
  brand: "bg-brand-600 text-white",
  amber: "bg-amber-500 text-white",
  rose: "bg-rose-600 text-white",
};

/** "Upload all required documents by Thu 4 Dec · 12 days left" */
export function DeadlineNotice({ due, status, allIn, className }: { due: string | null | undefined; status: EnrolmentStatus; allIn: boolean; className?: string }) {
  if (["completed", "cancelled"].includes(status)) return null;
  const d = deadlineInfo(due);
  if (!d) return null;
  if (allIn) {
    return (
      <div className={clsx("flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm", TONE.emerald, className)}>
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>All required documents are in – nothing more to send before <b>{d.date}</b>.</span>
      </div>
    );
  }
  return (
    <div role="status" className={clsx("flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border px-3 py-2.5 text-sm", TONE[d.tone], className)}>
      {d.n < 0 ? <AlarmClock className="h-4 w-4 shrink-0" /> : <CalendarClock className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        {d.n < 0
          ? <>Your documents were due on <b>{d.date}</b>. Please upload the rest as soon as you can.</>
          : <>Upload all required documents by <b>{d.date}</b></>}
      </span>
      <span className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold", CHIP[d.tone])}>{d.left}</span>
    </div>
  );
}

/** Small "Needed by 4 Dec" tag for one outstanding document. */
export function NeededByTag({ due }: { due: string | null | undefined }) {
  const d = deadlineInfo(due);
  if (!d) return null;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
      d.tone === "rose" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
        : d.tone === "amber" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          : "bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300")}>
      <CalendarClock className="h-3 w-3" />{d.n < 0 ? `Overdue since ${d.date}` : `Needed by ${d.date}`}
    </span>
  );
}
