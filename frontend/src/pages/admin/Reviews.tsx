import clsx from "clsx";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DraftEditor, ModelBadge } from "../../components/DraftEditor";
import { Avatar, Badge, EmptyState, ErrorState, Segmented, Skeleton } from "../../components/ui";
import { timeAgo } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Draft } from "../../lib/types";

export default function Reviews() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"draft" | "published" | "rejected">("draft");
  const { data, setData, error, loading, reload } = useApi<{ items: Draft[] }>(`/api/admin/drafts?status=${filter}`, [filter]);
  const selectedId = Number(params.get("id")) || null;
  const { data: direct } = useApi<{ draft: Draft }>(selectedId ? `/api/admin/drafts/${selectedId}` : null, [selectedId]);
  const items = data?.items ?? [];
  const selected = items.find((d) => d.id === selectedId) ?? direct?.draft ?? null;
  useEffect(() => {
    if (!selectedId && items.length) setParams({ id: String(items[0].id) }, { replace: true });
  }, [items, selectedId, setParams]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="h-page">Review queue</h1><p className="muted mt-1 text-sm">Every AI-drafted message waits here for a human. Edit freely – nothing is sent until you publish.</p></div>
        <Segmented value={filter} onChange={(v) => { setFilter(v); setParams({}, { replace: true }); }}
          options={[{ value: "draft", label: "To review" }, { value: "published", label: "Published" }, { value: "rejected", label: "Rejected" }]} />
      </div>
      {error && <ErrorState message={error.message} onRetry={reload} />}
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="card overflow-hidden">
          {loading && !data && <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>}
          {data && items.length === 0 && <EmptyState icon={<Sparkles className="h-6 w-6" />} title={filter === "draft" ? "No drafts waiting" : `No ${filter} drafts`}>Open an enrolment and use AI Assist → Draft reminder.</EmptyState>}
          <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
            {items.map((d) => (
              <button key={d.id} onClick={() => setParams({ id: String(d.id) })}
                className={clsx("relative block w-full px-4 py-3.5 text-left transition", d.id === selectedId ? "bg-brand-50/60 dark:bg-white/[0.04]" : "hover:bg-stone-50 dark:hover:bg-white/[0.02]")}>
                {d.id === selectedId && <motion.span layoutId="review-sel" className="absolute inset-y-0 left-0 w-1 rounded-r bg-brand-600" />}
                <div className="flex items-center gap-2"><Avatar name={d.customer_name ?? "?"} className="h-6 w-6 text-[10px]" />
                  <span className="truncate text-sm font-medium">{d.customer_name}</span><span className="ml-auto shrink-0 text-[11px] text-stone-400">{timeAgo(d.created_at)}</span></div>
                <div className="mt-1 truncate text-sm">{d.subject}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><ModelBadge d={d} /><Badge className="!py-0 text-[10px]">{d.channel}</Badge>
                  {!!d.validation?.warnings?.length && <Badge tone="amber" className="!py-0 text-[10px]">{d.validation.warnings.length} warning(s)</Badge>}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="card card-pad min-h-[400px]">
          {selected ? (
            <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-stone-100 pb-4 dark:border-white/[0.06]">
                <div><div className="font-semibold">{selected.customer_name}</div><div className="muted text-xs">{selected.programme_name} · {selected.enrolment_ref}</div></div>
                <Link to={`/admin/enrolments/${selected.enrolment_id}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">Open checklist <ArrowRight className="h-4 w-4" /></Link>
              </div>
              <DraftEditor draft={selected} onChanged={(nd) => {
                if (!nd) return;
                setData((cur) => cur && { items: nd.status === filter ? cur.items.map((x) => (x.id === nd.id ? { ...x, ...nd } : x)) : cur.items.filter((x) => x.id !== nd.id) });
                if (nd.status !== filter) setParams({}, { replace: true });
              }} />
            </motion.div>
          ) : <EmptyState icon={<Sparkles className="h-6 w-6" />} title="Select a draft">Pick a draft on the left to review it.</EmptyState>}
        </div>
      </div>
    </div>
  );
}
