import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileSpreadsheet, Search, Upload, Users, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Dropzone } from "../../components/chrome";
import { Avatar, Badge, Button, EmptyState, ErrorState, Modal, Skeleton, stagger } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { useApi, useDebounced } from "../../lib/hooks";

interface CustomerRow { id: number; customer_ref: string; full_name: string; email: string; phone: string | null; country: string | null; source: string; created_at: string; enrolment_count: number; has_login: number }
interface ImportReport { total_rows: number; imported: number; skipped_existing: number; rejected: number; errors: { row: number; customer_ref: string | null; field: string; message: string }[]; skipped_rows: { row: number; customer_ref: string; message: string }[] }

export default function Customers() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const { data, error, loading, reload } = useApi<{ items: CustomerRow[] }>(`/api/admin/customers?limit=200${dq ? `&q=${encodeURIComponent(dq)}` : ""}`, [dq]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const upload = async (files: File[]) => {
    const form = new FormData(); form.append("file", files[0]);
    setBusy(true); setReport(null);
    try { const r = await api.upload<{ report: ImportReport }>("/api/admin/import/crm", form); setReport(r.report); reload(); toast.success(`${r.report.imported} customer(s) imported`); }
    catch (e) { toast.error((e as ApiError).message, { description: Object.values((e as ApiError).fields)[0] }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="h-page">Customers</h1><p className="muted mt-1 text-sm">SQLite mirror of the CRM. Import exports through the connector – bad rows are reported, never silently dropped.</p></div>
        <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => { setImporting(true); setReport(null); }}>Import CRM export</Button>
      </div>
      <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" /><input className="input pl-9" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <ErrorState message={error.message} onRetry={reload} />}
      <div className="card overflow-x-auto">
        {loading && !data && <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {data?.items.length === 0 && <EmptyState icon={<Users className="h-6 w-6" />} title="No customers found" />}
        {!!data?.items.length && (
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-stone-100 text-left text-xs uppercase tracking-wide text-stone-400 dark:border-white/[0.06]">
              <th className="px-5 py-3 font-medium">Customer</th><th className="px-3 py-3 font-medium">Ref</th><th className="px-3 py-3 font-medium">Country</th>
              <th className="px-3 py-3 font-medium">Enrolments</th><th className="px-3 py-3 font-medium">Portal</th><th className="px-3 py-3 font-medium">Source</th><th className="px-5 py-3 font-medium">Added</th></tr></thead>
            <tbody className="divide-y divide-stone-100 dark:divide-white/[0.05]">
              {data.items.map((c, i) => (
                <motion.tr key={c.id} {...stagger(i)} className="hover:bg-stone-50 dark:hover:bg-white/[0.02]">
                  <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={c.full_name} /><div><div className="font-medium">{c.full_name}</div><div className="muted text-xs">{c.email}</div></div></div></td>
                  <td className="px-3 py-3 font-mono text-xs">{c.customer_ref}</td>
                  <td className="px-3 py-3">{c.country ?? "—"}</td>
                  <td className="px-3 py-3 tabular-nums">{c.enrolment_count}</td>
                  <td className="px-3 py-3">{c.has_login ? <Badge tone="emerald" dot>Active</Badge> : <Badge>None</Badge>}</td>
                  <td className="px-3 py-3"><Badge tone={c.source === "crm_import" ? "sky" : c.source === "self_signup" ? "violet" : "slate"}>{c.source.replace("_", " ")}</Badge></td>
                  <td className="muted px-5 py-3">{fmtDate(c.created_at)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={importing} onClose={() => setImporting(false)} size="lg" title="Import a CRM export" description="CSV or JSON with columns full_name, email and optionally customer_ref, phone, country. Processed with pandas."
        footer={<Button variant="secondary" onClick={() => setImporting(false)}>Done</Button>}>
        <Dropzone onFiles={upload} accept=".csv,.json" disabled={busy}>
          <FileSpreadsheet className="h-8 w-8 text-brand-500" />
          <p className="text-sm font-medium">{busy ? "Importing…" : "Drop a .csv or .json export"}</p>
          <p className="muted text-xs">Try <code>backend/data/sample/crm_export_with_errors.csv</code> to see validation.</p>
        </Dropzone>
        <AnimatePresence>
          {report && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center">
                {([["Rows", report.total_rows, "text-stone-700 dark:text-stone-200"], ["Imported", report.imported, "text-emerald-600 dark:text-emerald-400"],
                  ["Already there", report.skipped_existing, "text-sky-600 dark:text-sky-400"], ["Rejected", report.rejected, "text-rose-600 dark:text-rose-400"]] as const).map(([l, v, cls]) => (
                  <div key={l} className="rounded-xl bg-stone-50 p-3 dark:bg-white/[0.03]"><div className={`text-2xl font-semibold ${cls}`}>{v}</div><div className="muted text-xs">{l}</div></div>
                ))}
              </div>
              {report.errors.length > 0 && (
                <div className="space-y-1.5">
                  {report.errors.map((e, i) => <div key={i} className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm dark:bg-rose-500/10"><XCircle className="h-4 w-4 shrink-0 text-rose-500" /><span className="font-mono text-xs">row {e.row}</span><span className="text-xs text-stone-500">{e.field}</span>{e.message}</div>)}
                </div>
              )}
              {report.skipped_rows.map((s, i) => <div key={i} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-sky-500" /><span className="font-mono text-xs">row {s.row}</span>{s.customer_ref} – {s.message}</div>)}
            </motion.div>
          )}
        </AnimatePresence>
      </Modal>
    </div>
  );
}
