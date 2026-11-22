import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ExternalLink, FileSearch, FileText, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { UploaderBadge } from "../../components/status";
import { Avatar, Badge, Button, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { fileSize, timeAgo } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Submission } from "../../lib/types";

export default function Verification() {
  const { data, setData, error, loading, reload } = useApi<{ items: Submission[] }>("/api/admin/verification-queue");
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const remove = (id: number) => setData((d) => d && { items: d.items.filter((s) => s.id !== id) });
  const verify = async (s: Submission) => {
    setBusy(s.id);
    try { await api.post(`/api/admin/submissions/${s.id}/verify`); remove(s.id); toast.success(`${s.document_name} verified`, { description: s.customer_name }); }
    catch (e) { toast.error((e as ApiError).message); } finally { setBusy(null); }
  };
  const reject = async (s: Submission) => {
    setBusy(s.id);
    try { await api.post(`/api/admin/submissions/${s.id}/reject`, { reason }); remove(s.id); setRejecting(null); setReason(""); toast("Rejected – customer notified"); }
    catch (e) { toast.error((e as ApiError).fields.reason ?? (e as ApiError).message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      <div><h1 className="h-page">Verification queue</h1><p className="muted mt-1 text-sm">Documents waiting for a human check. Low-confidence NLP matches are shown first.</p></div>
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {data?.items.length === 0 && <div className="card"><EmptyState icon={<FileSearch className="h-6 w-6" />} title="All caught up">Nothing is waiting for verification.</EmptyState></div>}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {data?.items.map((s) => (
            <motion.div key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60, height: 0, marginTop: 0 }} className="card overflow-hidden">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-white/[0.06]"><FileText className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.document_name ?? "Unclassified upload"}</span>
                      <UploaderBadge role={s.uploaded_by_role} name={s.uploaded_by_name} channel={s.channel} />
                      {s.status === "needs_review" && <Badge tone="amber">needs a closer look</Badge>}
                      {typeof s.match_confidence === "number" && <span className="text-xs tabular-nums text-stone-400">{Math.round(s.match_confidence * 100)}% NLP match</span>}
                    </div>
                    <div className="muted truncate text-xs">{s.original_filename ?? "from customer message"} {s.file_size ? `· ${fileSize(s.file_size)}` : ""} · {timeAgo(s.created_at)}</div>
                    <Link to={`/admin/enrolments/${s.enrolment_id}`} className="mt-1 inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline dark:text-brand-300">
                      <Avatar name={s.customer_name ?? "?"} className="h-4 w-4 text-[8px]" />{s.customer_name} · {s.programme_name}
                    </Link>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {s.stored_path && <a href={`/api/admin/submissions/${s.id}/file`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Open</Button></a>}
                  {!s.required_document_id ? <Link to={`/admin/enrolments/${s.enrolment_id}`}><Button size="sm" variant="secondary">Assign type</Button></Link> : <>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" icon={<XCircle className="h-4 w-4" />} onClick={() => { setRejecting(rejecting === s.id ? null : s.id); setReason(""); }}>Reject</Button>
                    <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={busy === s.id && rejecting !== s.id} onClick={() => verify(s)}>Verify</Button>
                  </>}
                </div>
              </div>
              {(s.customer_note || s.extracted_text) && <div className="muted border-t border-stone-100 px-4 py-2.5 text-sm italic dark:border-white/[0.06]">“{(s.customer_note || s.extracted_text)!.slice(0, 220)}”</div>}
              <AnimatePresence>
                {rejecting === s.id && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-stone-100 dark:border-white/[0.06]">
                    <div className="flex gap-2 p-4">
                      <input className="input" autoFocus placeholder="Reason shown to the customer…" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reject(s)} />
                      <Button variant="danger" loading={busy === s.id} onClick={() => reject(s)}>Reject</Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
