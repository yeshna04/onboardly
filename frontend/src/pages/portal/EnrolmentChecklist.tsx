import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, FileText, MessageSquareText, Info, Loader2, PartyPopper, Sparkles, UploadCloud } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Dropzone } from "../../components/chrome";
import { DeadlineNotice, NeededByTag } from "../../components/Deadline";
import { useDemoGate } from "../../components/DemoGate";
import { FilePreviewModal, type PreviewFile } from "../../components/FilePreview";
import { DOC_STATE, DocStateIcon, DocStatePill, StatusPill, UploaderBadge } from "../../components/status";
import { Badge, ErrorState, Modal, PageSkeleton, ProgressRing, stagger } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { fileSize, fmtDate, timeAgo } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Checklist, ChecklistItem, Enrolment, Submission } from "../../lib/types";
import { NextStepCard, StageTracker } from "./Home";

interface Payload { enrolment: Enrolment; checklist: Checklist; submissions: Submission[] }
interface UploadResult extends Payload {
  submission: Submission; needs_confirmation: boolean; warning: string | null;
  suggestion: { doc_code: string; name: string; required_document_id: number; confidence: string } | null;
  alternatives: { doc_code: string; name: string; required_document_id: number }[];
}

const UPLOADABLE = new Set(["missing", "pending", "rejected", "expired"]);

export default function EnrolmentChecklist() {
  const { id = "" } = useParams();
  const { data, setData, error, loading, reload } = useApi<Payload>(`/api/portal/enrolments/${id}`, [id]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<UploadResult | null>(null);
  const [filter, setFilter] = useState<"all" | "todo">("all");
  const demo = useDemoGate();
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Error"} onRetry={reload} />;
  const { enrolment: e, checklist: cl } = data;
  const closed = ["completed", "cancelled"].includes(e.status);
  const items = cl.items.filter((i) => filter === "all" || UPLOADABLE.has(i.state));

  const upload = async (files: File[], item?: ChecklistItem) => {
    for (const f of files) {
      setUploading(item?.doc_code ?? "__any");
      const form = new FormData(); form.append("file", f); if (item) form.append("required_document_id", String(item.required_document_id));
      try {
        const r = await api.upload<UploadResult>(`/api/portal/enrolments/${e.id}/uploads`, form);
        setData({ enrolment: r.enrolment as Enrolment, checklist: r.checklist, submissions: r.submissions });
        if (r.needs_confirmation) setConfirming(r);
        else if (r.warning) toast.warning("Uploaded – we'll double-check it", { description: r.warning });
        else toast.success(item ? `${item.name} uploaded` : `Uploaded as your ${r.suggestion?.name ?? "document"}`, { description: "Our team will verify it shortly." });
      } catch (err) {
        if (demo.handleError(err)) break;
        const ae = err as ApiError;
        toast.error(`${f.name} wasn't uploaded`, { description: ae.fields.file ?? ae.message });
      }
    }
    setUploading(null);
  };

  const confirm = async (docId: number) => {
    if (!confirming) return;
    try {
      const r = await api.post<Payload>(`/api/portal/submissions/${confirming.submission.id}/confirm`, { required_document_id: docId });
      setData(r); setConfirming(null); toast.success("Thanks – got it!");
    } catch (err) { if (!demo.handleError(err)) toast.error((err as ApiError).message); }
  };

  return (
    <div className="space-y-6">
      <Link to="/portal" className="muted inline-flex items-center gap-1 text-sm hover:text-stone-900 dark:hover:text-white"><ArrowLeft className="h-4 w-4" /> My onboarding</Link>

      <motion.div {...stagger(0)} className="card overflow-hidden">
        <div className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-center">
          <ProgressRing value={cl.completion_pct} size={110} stroke={10}
            label={<div><div className="text-2xl font-semibold tabular-nums">{Math.round(cl.completion_pct)}%</div><div className="muted text-[11px]">complete</div></div>} />
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{e.programme_name}</h1><StatusPill status={e.status} /></div>
              <div className="muted mt-1 flex flex-wrap gap-x-4 text-sm"><span>{e.enrolment_ref}</span></div>
            </div>
            <StageTracker status={e.status} collected={cl.collected_count} cancelledAt={e.cancelled_at} />
            <DeadlineNotice due={e.due_date} status={e.status} allIn={cl.all_collected} />
          </div>
        </div>
        <AnimatePresence>
          {e.status === "cancelled" && (
            <div className="flex items-start gap-3 border-t border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div><b>This enrolment was cancelled{e.cancelled_at ? ` on ${fmtDate(e.cancelled_at)}` : ""}.</b> {e.cancellation_reason ? <>Reason: “{e.cancellation_reason}”.</> : null} Your documents stay here for reference, but nothing more is needed. <Link to="/portal/messages" className="font-semibold underline">Message the team</Link> if you have questions.</div>
            </div>
          )}
          {cl.all_collected && !closed && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} className="overflow-hidden border-t border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <div className="flex items-center gap-3 px-6 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                <motion.span animate={{ rotate: [0, -12, 12, 0] }} transition={{ repeat: 2, duration: 0.6 }}><PartyPopper className="h-5 w-5" /></motion.span>
                Everything required is in – brilliant! Our team is verifying your documents now.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your documents</h2>
            <div className="flex gap-1 rounded-xl bg-stone-100 p-1 text-sm dark:bg-white/[0.05]">
              {(["all", "todo"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={clsx("rounded-lg px-3 py-1 font-medium transition", filter === f ? "bg-white shadow-sm dark:bg-white/10" : "text-stone-500")}>
                  {f === "all" ? `All ${cl.items.length}` : `To do ${cl.items.filter((i) => UPLOADABLE.has(i.state)).length}`}
                </button>
              ))}
            </div>
          </div>
          <AnimatePresence mode="popLayout">
            {items.map((item, i) => (
              <DocCard key={item.doc_code} item={item} index={i} closed={closed} busy={uploading === item.doc_code} due={e.due_date}
                submission={data.submissions.find((s) => s.id === item.submission_id)} onUpload={(f) => upload(f, item)}
                onView={(s) => setPreview({ url: `/api/portal/submissions/${s.id}/file`, name: s.original_filename ?? "Document", mime: s.mime_type, size: s.file_size, subtitle: item.name })} />
            ))}
          </AnimatePresence>
          {items.length === 0 && <div className="card card-pad text-center text-sm"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />Nothing left to upload. 🎉</div>}
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <NextStepCard step={cl.next_step} due={closed ? null : e.due_date} />
          {!closed && (
            <div className="card card-pad">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-500" />Not sure which one it is?</div>
              <Dropzone onFiles={(f) => upload(f)} disabled={!!uploading}>
                {uploading === "__any" ? <><Loader2 className="h-6 w-6 animate-spin text-brand-500" /><p className="text-sm font-medium">Reading your file…</p></> : <>
                  <UploadCloud className="h-7 w-7 text-brand-500" />
                  <p className="text-sm font-medium">Drop any document here</p>
                  <p className="muted text-xs">We'll recognise what it is from the file name and your note.</p></>}
              </Dropzone>
            </div>
          )}
          <div className="card card-pad text-sm">
            <div className="mb-2 flex items-center gap-2 font-semibold"><Info className="h-4 w-4 text-sky-500" />What the colours mean</div>
            <ul className="space-y-1.5">
              {(["missing", "submitted", "verified", "rejected"] as const).map((s) => <li key={s} className="flex items-center gap-2"><DocStateIcon state={s} className="h-4 w-4" />{DOC_STATE[s].customer}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
      <Modal open={!!confirming} onClose={() => setConfirming(null)} size="md" title="Which document is this?"
        description={confirming ? `We received “${confirming.submission.original_filename}”.` : undefined}>
        {confirming && (
          <div className="space-y-3">
            {confirming.suggestion && <p className="text-sm">We think it's your <b>{confirming.suggestion.name}</b> – is that right?</p>}
            <div className="grid gap-2">
              {[...(confirming.suggestion ? [confirming.suggestion] : []), ...cl.items.filter((i) => i.doc_code !== confirming.suggestion?.doc_code)].map((d, i) => (
                <button key={d.doc_code} onClick={() => confirm(d.required_document_id)}
                  className={clsx("flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-500/10",
                    i === 0 && confirming.suggestion ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/10" : "border-stone-200 dark:border-white/10")}>
                  <FileText className="h-4 w-4 text-stone-400" /><span className="flex-1 font-medium">{d.name}</span>
                  {i === 0 && confirming.suggestion && <Badge tone="brand">Suggested</Badge>}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DocCard({ item, index, closed, busy, submission, onUpload, onView, due }: { item: ChecklistItem; index: number; closed: boolean; busy: boolean; due?: string | null; submission?: Submission; onUpload: (f: File[]) => void; onView: (s: Submission) => void }) {
  const canUpload = !closed && UPLOADABLE.has(item.state);
  const [justDone, setJustDone] = useState(false);
  return (
    <motion.div layout {...stagger(index)} exit={{ opacity: 0, scale: 0.98 }}
      className={clsx("card overflow-hidden", item.state === "rejected" && "ring-2 ring-rose-200 dark:ring-rose-500/30", item.state === "verified" && "bg-emerald-50/30 dark:bg-emerald-500/[0.03]")}>
      <div className="flex gap-4 p-5">
        <motion.div key={item.state} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }} onAnimationComplete={() => setJustDone(false)}>
          <DocStateIcon state={item.state} className={clsx("h-7 w-7", justDone && "animate-bounce")} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.name}</h3>{!item.is_mandatory && <Badge className="!py-0 text-[10px]">optional</Badge>}
            <span className="ml-auto"><DocStatePill state={item.state} customer /></span></div>
          <p className="muted mt-1 text-sm">{item.description}</p>
          {item.why_needed && <p className="mt-1 text-xs text-stone-400">Why: {item.why_needed}</p>}
          {canUpload && item.is_mandatory ? <div className="mt-2"><NeededByTag due={due} /></div> : null}
          {item.state === "rejected" && item.rejection_reason && (
            <div className="mt-3 flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Please upload a new copy:</b> {item.rejection_reason}</span></div>
          )}
          {item.state === "pending" && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">You told us this is on its way – upload it whenever it's ready.</p>}
          {submission?.added_by_staff && item.state !== "missing" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <UploaderBadge role="admin" audience="customer" />
              <span className="muted">Our team uploaded this for you – you don't need to send it again.</span>
            </div>
          )}
          {submission?.from_message && item.state !== "missing" && (
            <div className="mt-3 flex flex-wrap items-start gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25"><MessageSquareText className="h-3 w-3" />Noted from your message</span>
              {submission.customer_note && <span className="muted min-w-0 flex-1 italic">“{submission.customer_note}” · {timeAgo(submission.created_at)}</span>}
            </div>
          )}
          {submission && item.state !== "missing" && !submission.from_message && (
            <div className="muted mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {submission.original_filename && (submission.has_file ? (
                <button onClick={() => onView(submission)} title="View the file you sent"
                  className="group inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white/60 px-2 py-1 font-medium text-stone-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-200 dark:hover:border-brand-400/50 dark:hover:text-brand-200">
                  <FileText className="h-3.5 w-3.5" />{submission.original_filename}{submission.file_size ? <span className="muted font-normal"> · {fileSize(submission.file_size)}</span> : null}
                  <span className="ml-1 inline-flex items-center gap-1 text-brand-600 dark:text-brand-300"><Eye className="h-3.5 w-3.5" />View</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1" title="Preview isn't available for this sample record"><FileText className="h-3.5 w-3.5" />{submission.original_filename}{submission.file_size ? ` · ${fileSize(submission.file_size)}` : ""}</span>
              ))}
              <span>sent {timeAgo(submission.created_at)}</span>
              {item.verified_at && item.state === "verified" && <span className="text-emerald-600 dark:text-emerald-400">verified {timeAgo(item.verified_at)}</span>}
            </div>
          )}
          {canUpload && (
            <div className="mt-4">
              <Dropzone compact onFiles={(f) => { setJustDone(true); onUpload(f); }} disabled={busy} accept={item.accepted_formats.split(",").map((x) => `.${x.trim()}`).join(",")}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin text-brand-500" />Uploading…</> : <><UploadCloud className="h-4 w-4 text-brand-500" />{item.state === "rejected" || item.state === "expired" ? "Upload a new copy" : "Upload"} <span className="muted font-normal">· {item.accepted_formats.toUpperCase().replace(/,/g, ", ")}</span></>}
                </span>
              </Dropzone>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
