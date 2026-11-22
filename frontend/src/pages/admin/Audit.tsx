import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ScrollText, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, EmptyState, ErrorState, Segmented, Skeleton } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { useApi, useDebounced } from "../../lib/hooks";

interface Entry { id: number; action: string; actor_role: string; actor_name: string | null; entity_type: string; entity_id: number | null; enrolment_id: number | null; enrolment_ref: string | null; details: Record<string, unknown>; ip_address: string | null; created_at: string }

const PAGE = 40;
export default function Audit() {
  const [role, setRole] = useState<"" | "admin" | "customer" | "system">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const dq = useDebounced(q, 300);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE), ...(role && { actor_role: role }), ...(dq && { q: dq }) }).toString();
  const { data, error, loading, reload } = useApi<{ items: Entry[]; total: number }>(`/api/admin/audit?${qs}`, [qs]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <div className="space-y-5">
      <div><h1 className="h-page">Audit log</h1><p className="muted mt-1 text-sm">Append-only record of every consequential action – the database refuses edits and deletes.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented size="sm" value={role} onChange={(v) => { setRole(v); setPage(0); }} options={[{ value: "", label: "Everyone" }, { value: "admin", label: "Staff" }, { value: "customer", label: "Customers" }, { value: "system", label: "System" }]} />
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" /><input className="input pl-9" placeholder="Search actions or details…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
        {data && <span className="muted ml-auto text-sm">{data.total} entries</span>}
      </div>
      {error && <ErrorState message={error.message} onRetry={reload} />}
      <div className="card overflow-hidden">
        {loading && !data && <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
        {data?.items.length === 0 && <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No entries" />}
        <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
          {data?.items.map((a) => (
            <div key={a.id}>
              <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-stone-50 dark:hover:bg-white/[0.02]">
                <ChevronRight className={clsx("h-4 w-4 shrink-0 text-stone-400 transition", open === a.id && "rotate-90")} />
                <span className="w-36 shrink-0 text-xs tabular-nums text-stone-400">{fmtDateTime(a.created_at)}</span>
                <code className="rounded-md bg-stone-100 px-1.5 py-0.5 text-xs dark:bg-white/[0.06]">{a.action}</code>
                <span className="truncate">{a.actor_name?.replace(/\s*\(.*\)/, "") ?? "System"}</span>
                <Badge tone={a.actor_role === "admin" ? "brand" : a.actor_role === "customer" ? "emerald" : "slate"} className="ml-auto">{a.actor_role}</Badge>
                {a.enrolment_ref && <Link onClick={(e) => e.stopPropagation()} to={`/admin/enrolments/${a.enrolment_id}`} className="hidden text-xs text-brand-600 hover:underline dark:text-brand-300 sm:inline">{a.enrolment_ref}</Link>}
              </button>
              <AnimatePresence>
                {open === a.id && (
                  <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-x-auto bg-stone-50 px-12 py-3 text-xs leading-5 text-stone-600 dark:bg-white/[0.02] dark:text-stone-300">
                    {JSON.stringify({ entity: `${a.entity_type}#${a.entity_id ?? "–"}`, ip: a.ip_address, ...a.details }, null, 2)}
                  </motion.pre>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="muted text-sm">Page {page + 1} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
