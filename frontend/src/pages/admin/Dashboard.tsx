import clsx from "clsx";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Clock, Download, FileSearch, GraduationCap, Inbox, Plus, Sparkles, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS_TONE } from "../../components/status";
import { AnimatedNumber, Avatar, Badge, Button, DOT, ErrorState, PageSkeleton, ProgressBar, stagger } from "../../components/ui";
import { dueLabel, STATUS_LABEL, timeAgo } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Enrolment, EnrolmentStatus } from "../../lib/types";
import { NewEnrolmentModal } from "./NewEnrolment";

interface Stats {
  by_status: Record<EnrolmentStatus, number>; active_enrolments: number; avg_completion_pct: number; awaiting_verification: number;
  needs_review: number; pending_drafts: number; unread_customer_messages: number; overdue: number; llm_calls_24h: number;
  attention: { id: number; enrolment_ref: string; status: EnrolmentStatus; completion_pct: number; due_date: string; customer_name: string; programme_name: string; reason: string }[];
  recent_activity: { id: number; action: string; actor_role: string; created_at: string; enrolment_id: number | null; actor_name: string | null; enrolment_ref: string | null; customer_name: string | null }[];
  by_programme: { code: string; name: string; enrolments: number; active: number; completed: number; avg_completion_pct: number }[];
  document_bottlenecks: { name: string; outstanding: number; rejected: number }[];
}

const ACTION_TEXT: Record<string, string> = {
  "enrolment.created": "created an enrolment", "enrolment.status_changed": "status changed", "submission.uploaded": "uploaded a document",
  "submission.created": "added a document", "submission.verified": "verified a document", "submission.rejected": "rejected a document",
  "submission.reassigned": "reclassified a document", "draft.published": "published a reminder", "draft.rejected": "rejected a draft",
  "ai.draft_reminder": "drafted a reminder with AI", "ai.explain_outstanding": "asked AI to explain", "message.received": "sent a message",
  "message.published": "messaged the customer", "nlp.intake_analysed": "analysed an email", "crm.import": "imported customers",
  "invite.accepted": "joined the portal", "customer.self_signup": "signed up", "enrolment.completed": "completed onboarding",
};

const COLUMNS: EnrolmentStatus[] = ["new", "awaiting_docs", "ready_for_review", "completed"];

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<Stats>("/api/admin/dashboard");
  const { data: enrolments } = useApi<{ items: Enrolment[] }>("/api/admin/enrolments?limit=200");
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Could not load"} onRetry={reload} />;

  const kpis = [
    { label: "Active enrolments", value: data.active_enrolments, icon: GraduationCap, tone: "from-brand-400 to-brand-600", to: "/admin/enrolments" },
    { label: "Average completion", value: data.avg_completion_pct, suffix: "%", icon: TrendingUp, tone: "from-emerald-500 to-teal-600", to: "/admin/enrolments" },
    { label: "Awaiting verification", value: data.awaiting_verification, icon: FileSearch, tone: "from-sky-500 to-cyan-600", to: "/admin/verification", sub: data.needs_review ? `${data.needs_review} need a closer look` : undefined },
    { label: "Drafts to review", value: data.pending_drafts, icon: Sparkles, tone: "from-accent-400 to-accent-600", to: "/admin/reviews", sub: data.overdue ? `${data.overdue} enrolment(s) overdue` : undefined },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h-page"><span className="text-gradient">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}</span> 👋</h1>
          <p className="muted mt-1 text-sm">Here's where every onboarding stands today.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/admin/reports/onboarding.csv"><Button variant="secondary" icon={<Download className="h-4 w-4" />}>Export CSV</Button></a>
          <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>New enrolment</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div key={k.label} {...stagger(i)}>
            <Link to={k.to} className="card card-pad group block transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-start justify-between">
                <div className="muted text-[13px] font-medium">{k.label}</div>
                <div className={clsx("flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", k.tone)}><k.icon className="h-[18px] w-[18px]" /></div>
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight"><AnimatedNumber value={k.value} decimals={k.suffix ? 1 : 0} suffix={k.suffix} /></div>
              <div className="muted mt-1 flex items-center gap-1 text-xs">{k.sub ?? "View all"}<ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" /></div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* pipeline board */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-white/[0.06]">
          <div><h2 className="font-semibold">Onboarding pipeline</h2><p className="muted text-xs">Each card is an enrolment – click to open the workspace.</p></div>
          <Link to="/admin/enrolments" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">All enrolments</Link>
        </div>
        <div className="grid gap-3 overflow-x-auto p-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const cards = (enrolments?.items ?? []).filter((e) => e.status === col);
            return (
              <div key={col} className="min-w-[240px] rounded-2xl bg-stone-50 p-2.5 dark:bg-white/[0.02]">
                <div className="flex items-center gap-2 px-1.5 pb-2.5 pt-1 text-sm font-medium">
                  <span className={clsx("h-2 w-2 rounded-full", DOT[STATUS_TONE[col]])} />{STATUS_LABEL[col]}
                  <span className="muted ml-auto text-xs">{data.by_status[col] ?? 0}</span>
                </div>
                <div className="scrollbar-thin max-h-[340px] space-y-2 overflow-y-auto pr-0.5">
                  {cards.length === 0 && <div className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-xs text-stone-400 dark:border-white/10">Empty</div>}
                  {cards.map((e, i) => {
                    const due = dueLabel(e.due_date);
                    return (
                      <motion.button key={e.id} {...stagger(i)} whileHover={{ y: -2 }} onClick={() => nav(`/admin/enrolments/${e.id}`)}
                        className="w-full rounded-xl border border-stone-200/80 bg-white p-3 text-left shadow-sm transition hover:shadow-md dark:border-white/[0.07] dark:bg-[#2b1728]">
                        <div className="flex items-center gap-2">
                          <Avatar name={e.customer_name} className="h-6 w-6 text-[10px]" />
                          <span className="truncate text-sm font-medium">{e.customer_name}</span>
                        </div>
                        <div className="muted mt-1 truncate text-xs">{e.programme_name}</div>
                        <ProgressBar value={e.completion_pct} className="mt-2.5" />
                        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                          <span className="tabular-nums text-stone-500">{Math.round(e.completion_pct)}%</span>
                          {due && col !== "completed" && <Badge tone={due.tone} className="!px-1.5 !py-0 text-[10px]">{due.text}</Badge>}
                          {!!e.pending_drafts && <Badge tone="violet" className="!px-1.5 !py-0 text-[10px]">draft</Badge>}
                          {!!e.awaiting_verification && <Badge tone="sky" className="!px-1.5 !py-0 text-[10px]">{e.awaiting_verification} to verify</Badge>}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card card-pad xl:col-span-2">
          <h2 className="font-semibold">Completion by programme</h2>
          <p className="muted text-xs">Average share of mandatory documents collected, active enrolments only.</p>
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_programme} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: "#a8a29e" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: "#a8a29e" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(249,115,22,.08)" }} content={<ProgrammeTooltip />} />
                <defs><linearGradient id="bar-sunset" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fb923c" /><stop offset="1" stopColor="#ec4899" /></linearGradient></defs>
                <Bar dataKey="avg_completion_pct" radius={[0, 8, 8, 0]} fill="url(#bar-sunset)" barSize={22} animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card card-pad">
          <h2 className="font-semibold">Document bottlenecks</h2>
          <p className="muted text-xs">Most often outstanding (pandas analysis).</p>
          <div className="mt-4 space-y-3">
            {data.document_bottlenecks.length === 0 && <p className="muted text-sm">Nothing outstanding 🎉</p>}
            {data.document_bottlenecks.map((b, i) => {
              const max = data.document_bottlenecks[0]?.outstanding || 1;
              return (
                <div key={b.name}>
                  <div className="flex justify-between text-sm"><span>{b.name}</span><span className="tabular-nums text-stone-500">{b.outstanding}{b.rejected ? <span className="text-rose-500"> · {b.rejected} rejected</span> : null}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-white/[0.06]">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500" initial={{ width: 0 }} animate={{ width: `${(b.outstanding / max) * 100}%` }} transition={{ delay: i * 0.06, duration: 0.7 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4 dark:border-white/[0.06]"><AlertTriangle className="h-4 w-4 text-amber-500" /><h2 className="font-semibold">Needs attention</h2></div>
          <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
            {data.attention.length === 0 && <p className="muted p-6 text-center text-sm">Nothing urgent.</p>}
            {data.attention.map((a) => {
              const due = dueLabel(a.due_date);
              return (
                <Link key={a.id} to={`/admin/enrolments/${a.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-stone-50 dark:hover:bg-white/[0.02]">
                  <Avatar name={a.customer_name} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.customer_name}</div><div className="muted truncate text-xs">{a.programme_name}</div></div>
                  <Badge tone={a.reason === "overdue" ? "rose" : a.reason === "needs_review" ? "violet" : a.reason === "ready_for_review" ? "sky" : "amber"}>
                    {a.reason === "overdue" ? due?.text : a.reason === "needs_review" ? "Check a document" : a.reason === "ready_for_review" ? "Ready to verify" : due?.text}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4 dark:border-white/[0.06]"><Clock className="h-4 w-4 text-brand-500" /><h2 className="font-semibold">Recent activity</h2>
            {!!data.unread_customer_messages && <Link to="/admin/inbox" className="ml-auto"><Badge tone="rose" icon={<Inbox className="h-3 w-3" />}>{data.unread_customer_messages} unread</Badge></Link>}
          </div>
          <ol className="relative space-y-0 px-5 py-3">
            {data.recent_activity.map((a, i) => (
              <motion.li key={a.id} {...stagger(i)} className="relative flex gap-3 py-2 pl-5">
                <span className="absolute left-[3px] top-0 h-full w-px bg-stone-200 dark:bg-white/10" />
                <span className={clsx("absolute left-0 top-3.5 h-[7px] w-[7px] rounded-full ring-4 ring-white dark:ring-[#1d0f1b]",
                  a.actor_role === "customer" ? "bg-emerald-500" : a.actor_role === "system" ? "bg-stone-400" : "bg-brand-500")} />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{a.actor_name?.replace(/\s*\(.*\)/, "") ?? "System"}</span>{" "}
                  <span className="muted">{ACTION_TEXT[a.action] ?? a.action}</span>
                  {a.customer_name && a.enrolment_id && <> · <Link to={`/admin/enrolments/${a.enrolment_id}`} className="text-brand-600 hover:underline dark:text-brand-300">{a.customer_name}</Link></>}
                </div>
                <span className="shrink-0 text-xs text-stone-400">{timeAgo(a.created_at)}</span>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
      <NewEnrolmentModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

/** Chart tooltip styled with the app's own tokens so it reads well in light and dark mode. */
function ProgrammeTooltip({ active, payload }: { active?: boolean; payload?: { payload: { name: string; avg_completion_pct: number; active: number; completed: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[200px] rounded-xl border border-stone-200 bg-white/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-plum-900/95">
      <div className="mb-1.5 font-semibold text-stone-900 dark:text-white">{p.name}</div>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-brand-400 to-accent-500" />
        <span className="text-stone-500 dark:text-stone-400">Avg completion</span>
        <span className="ml-auto font-semibold tabular-nums text-stone-900 dark:text-white">{p.avg_completion_pct}%</span>
      </div>
      <div className="mt-1 text-stone-500 dark:text-stone-400">{p.active} active · {p.completed} completed</div>
    </div>
  );
}
