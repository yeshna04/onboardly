import clsx from "clsx";
import { motion } from "framer-motion";
import { ChevronRight, GraduationCap, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StatusPill } from "../../components/status";
import { Avatar, Badge, Button, EmptyState, ErrorState, ProgressRing, Skeleton, stagger } from "../../components/ui";
import { dueLabel, STATUS_LABEL, timeAgo } from "../../lib/format";
import { useApi, useDebounced } from "../../lib/hooks";
import type { Enrolment, EnrolmentStatus, Programme } from "../../lib/types";
import { NewEnrolmentModal } from "./NewEnrolment";

const FILTERS: (EnrolmentStatus | "")[] = ["", "new", "awaiting_docs", "ready_for_review", "completed", "cancelled"];

export default function Enrolments() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const programme = params.get("programme_id") ?? "";
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const qs = new URLSearchParams({ ...(status && { status }), ...(programme && { programme_id: programme }), ...(dq && { q: dq }) }).toString();
  const { data, error, loading, reload } = useApi<{ items: Enrolment[] }>(`/api/admin/enrolments?${qs}`, [qs]);
  const { data: all } = useApi<{ items: Enrolment[] }>("/api/admin/enrolments");
  const { data: programmes } = useApi<{ items: Programme[] }>("/api/programmes");
  const counts = (all?.items ?? []).reduce<Record<string, number>>((acc, e) => { acc[e.status] = (acc[e.status] ?? 0) + 1; acc[""] = (acc[""] ?? 0) + 1; return acc; }, {});
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="h-page">Enrolments</h1><p className="muted mt-1 text-sm">Every customer on every programme, with live checklist progress.</p></div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New enrolment</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f || "all"} onClick={() => set("status", f)}
            className={clsx("rounded-full px-3 py-1.5 text-sm font-medium transition",
              status === f ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-stone-300 dark:bg-white/[0.04] dark:text-stone-300 dark:ring-white/10")}>
            {f ? STATUS_LABEL[f] : "All"} <span className="ml-1 opacity-60">{counts[f] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <select className="input w-auto" value={programme} onChange={(e) => set("programme_id", e.target.value)}>
            <option value="">All programmes</option>
            {programmes?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {error ? <ErrorState message={error.message} onRetry={reload} /> : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[2fr_1.6fr_1fr_1fr_1fr_24px] gap-4 border-b border-stone-100 px-5 py-3 text-xs font-medium uppercase tracking-wide text-stone-400 dark:border-white/[0.06] md:grid">
            <span>Customer</span><span>Programme</span><span>Status</span><span>Progress</span><span>Due</span><span />
          </div>
          {loading && !data && <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
          {data?.items.length === 0 && <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No enrolments match">Try a different filter or search.</EmptyState>}
          <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
            {data?.items.map((e, i) => {
              const due = dueLabel(e.due_date);
              return (
                <motion.button key={e.id} {...stagger(i)} onClick={() => nav(`/admin/enrolments/${e.id}`)}
                  className="group grid w-full grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 text-left transition hover:bg-stone-50 dark:hover:bg-white/[0.02] md:grid-cols-[2fr_1.6fr_1fr_1fr_1fr_24px]">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={e.customer_name} className="h-9 w-9" />
                    <div className="min-w-0"><div className="truncate text-sm font-medium">{e.customer_name}</div><div className="muted truncate text-xs">{e.enrolment_ref} · updated {timeAgo(e.updated_at)}</div></div>
                  </div>
                  <div className="hidden min-w-0 md:block"><div className="truncate text-sm">{e.programme_name}</div><div className="muted text-xs">{e.programme_category}</div></div>
                  <div className="hidden md:block"><StatusPill status={e.status} /></div>
                  <div className="flex items-center gap-2"><ProgressRing value={e.completion_pct} size={36} stroke={4} label={<span className="text-[10px] font-semibold">{Math.round(e.completion_pct)}</span>} />
                    <div className="hidden flex-col gap-0.5 lg:flex">
                      {!!e.awaiting_verification && <span className="text-[11px] text-sky-600 dark:text-sky-400">{e.awaiting_verification} to verify</span>}
                      {!!e.pending_drafts && <span className="text-[11px] text-violet-600 dark:text-violet-400">draft ready</span>}
                    </div>
                  </div>
                  <div className="hidden md:block">{due && !["completed", "cancelled"].includes(e.status) ? <Badge tone={due.tone}>{due.text}</Badge> : <span className="muted text-sm">—</span>}</div>
                  <ChevronRight className="hidden h-4 w-4 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-stone-500 md:block" />
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
      <NewEnrolmentModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
    </div>
  );
}
