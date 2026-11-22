import clsx from "clsx";
import { motion } from "framer-motion";
import { ArrowRight, Ban, CalendarDays, CheckCircle2, Clock, Hourglass, Mail, MessageCircle, PartyPopper, Plus, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { deadlineInfo } from "../../components/Deadline";
import { StatusPill } from "../../components/status";
import { Badge, Button, ErrorState, PageSkeleton, ProgressRing, stagger } from "../../components/ui";
import { fmtDate, timeAgo } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { EnrolmentStatus, Message, NextStep } from "../../lib/types";

interface Card {
  id: number; enrolment_ref: string; status: EnrolmentStatus; completion_pct: number; programme_name: string; programme_category: string;
  due_date: string | null; target_start_date: string | null; next_step: NextStep; required_count: number; collected_count: number; verified_count: number;
  cancelled_at?: string | null; cancellation_reason?: string | null;
}
interface Overview { customer: { full_name: string }; enrolments: Card[]; unread_messages: number; latest_messages: Message[] }

const STAGES = ["Enrolled", "Documents", "Review", "Complete"];
export function stageIndex(status: EnrolmentStatus, collected: number) {
  if (status === "completed") return 3;
  if (status === "ready_for_review") return 2;
  return collected > 0 || status === "awaiting_docs" ? 1 : 0;
}

export function StageTracker({ status, collected, cancelledAt }: { status: EnrolmentStatus; collected: number; cancelledAt?: string | null }) {
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
        <Ban className="h-4 w-4 shrink-0" />
        <span><b>Onboarding stopped</b>{cancelledAt ? <> on {fmtDate(cancelledAt)}</> : null} – no further documents are needed.</span>
      </div>
    );
  }
  const idx = stageIndex(status, collected);
  return (
    <div className="flex items-center">
      {STAGES.map((s, i) => (
        <div key={s} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.08 }}
              className={clsx("flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                i < idx ? "bg-emerald-500 text-white" : i === idx ? "bg-brand-600 text-white ring-4 ring-brand-500/20" : "bg-stone-100 text-stone-400 dark:bg-white/[0.06]")}>
              {i < idx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </motion.div>
            <span className={clsx("text-[11px] font-medium", i <= idx ? "text-stone-700 dark:text-stone-200" : "text-stone-400")}>{s}</span>
          </div>
          {i < STAGES.length - 1 && (
            <div className="mx-1.5 mb-5 h-0.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-white/[0.06]">
              <motion.div className="h-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: i < idx ? "100%" : "0%" }} transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function NextStepCard({ step, to, due }: { step: NextStep; to?: string; due?: string | null }) {
  const deadline = step.kind === "upload" ? deadlineInfo(due) : null;
  const icon = step.kind === "upload" ? <Upload className="h-5 w-5" /> : step.kind === "wait" ? <Hourglass className="h-5 w-5" /> : step.kind === "cancelled" ? <Ban className="h-5 w-5" /> : <PartyPopper className="h-5 w-5" />;
  const tone = step.kind === "upload" ? "from-brand-500 to-accent-600" : step.kind === "wait" ? "from-sky-500 to-cyan-600" : step.kind === "cancelled" ? "from-stone-600 to-rose-900" : "from-emerald-500 to-teal-600";
  const inner = (
    <div className={clsx("relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-lift", tone)}>
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <div className="relative flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{step.kind === "cancelled" ? "Reason given by your onboarding team" : "Your next step"}</div>
          {step.kind === "cancelled" ? <>
            <div className="text-lg font-semibold leading-snug">“{step.detail}”</div>
            <div className="mt-1 inline-flex items-center gap-1 text-sm text-white/80"><MessageCircle className="h-3.5 w-3.5" />Questions? Message your onboarding team.</div>
          </> : <>
            <div className="text-lg font-semibold leading-snug">{step.title}</div>
            <div className="text-sm text-white/80">{step.detail}</div>
            {deadline && <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold ring-1 ring-white/30">
              <CalendarDays className="h-3.5 w-3.5" />{deadline.n < 0 ? `Was needed by ${deadline.date} · ${deadline.left}` : `Needed by ${deadline.date} · ${deadline.left}`}</div>}
          </>}
        </div>
        {to && <ArrowRight className="h-5 w-5 shrink-0 transition group-hover:translate-x-1" />}
      </div>
    </div>
  );
  return to ? <Link to={to} className="group block">{inner}</Link> : inner;
}

export default function Home() {
  const { data, error, loading, reload } = useApi<Overview>("/api/portal/overview");
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Error"} onRetry={reload} />;
  const first = data.customer.full_name.split(" ")[0];
  return (
    <div className="space-y-8">
      <motion.div {...stagger(0)}>
        <h1 className="text-3xl font-semibold tracking-tight">Hi <span className="text-gradient">{first}</span> 👋</h1>
        <p className="muted mt-1">Here's everything you need to finish onboarding – we'll keep it up to date as you upload.</p>
      </motion.div>

      {data.enrolments.length === 0 && (
        <div className="card card-pad text-center">
          <p className="font-medium">You're not enrolled on a programme yet.</p>
          <Link to="/portal/programmes" className="mt-4 inline-block"><Button icon={<Plus className="h-4 w-4" />}>Browse programmes</Button></Link>
        </div>
      )}

      {[...data.enrolments].sort((a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled")).map((e, i) => {
        const cancelled = e.status === "cancelled";
        return (
          <motion.section key={e.id} {...stagger(i + 1)} className={clsx("card overflow-hidden", cancelled && "ring-1 ring-rose-200/70 dark:ring-rose-500/20")}>
            {cancelled && <div className="h-1 bg-[repeating-linear-gradient(45deg,#f43f5e_0_10px,transparent_10px_20px)] opacity-60" />}
            <div className="grid gap-6 p-6 lg:grid-cols-[auto_1fr_1.1fr] lg:items-center">
              <div className={clsx(cancelled && "opacity-40 grayscale")}><ProgressRing value={e.completion_pct} size={120} stroke={10}
                label={<div><div className="text-2xl font-semibold tabular-nums">{e.collected_count}<span className="text-base text-stone-400">/{e.required_count}</span></div><div className="muted text-[11px]">documents in</div></div>} /></div>
              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className={clsx("text-xl font-semibold", cancelled && "text-stone-500 line-through decoration-rose-400/60 dark:text-stone-400")}>{e.programme_name}</h2><StatusPill status={e.status} /></div>
                  <div className="muted mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>{e.enrolment_ref}</span>
                    {e.target_start_date && <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" />Starts {fmtDate(e.target_start_date)}</span>}
                  </div>
                </div>
                <StageTracker status={e.status} collected={e.collected_count} cancelledAt={e.cancelled_at} />
              </div>
              <div className="space-y-3">
                <NextStepCard step={e.next_step} due={e.due_date} to={`/portal/enrolments/${e.id}`} />
                <Link to={`/portal/enrolments/${e.id}`} className="flex items-center justify-end gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">{cancelled ? "View details" : "View full checklist"} <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </div>
          </motion.section>
        );
      })}

      {data.latest_messages.length > 0 && (
        <motion.section {...stagger(4)} className="card">
          <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 dark:border-white/[0.06]">
            <h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-brand-500" />From your onboarding team {data.unread_messages > 0 && <Badge tone="rose">{data.unread_messages} new</Badge>}</h2>
            <Link to="/portal/messages" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">All messages</Link>
          </div>
          <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
            {data.latest_messages.map((m) => (
              <Link key={m.id} to="/portal/messages" className="flex items-start gap-3 px-6 py-4 transition hover:bg-stone-50 dark:hover:bg-white/[0.02]">
                <span className={clsx("mt-2 h-2 w-2 shrink-0 rounded-full", m.is_read ? "bg-transparent" : "bg-brand-500")} />
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium">{m.subject}</span><span className="muted ml-auto shrink-0 text-xs">{timeAgo(m.created_at)}</span></div>
                  <p className="muted line-clamp-2 text-sm">{m.body}</p></div>
              </Link>
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}
