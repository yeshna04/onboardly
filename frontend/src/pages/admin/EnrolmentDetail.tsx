import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Ban, CalendarDays, CheckCircle2, ChevronDown, Copy, ExternalLink, FileText, GitBranch, Link2, Mail, MessageSquarePlus,
  Pencil, RefreshCw, Send, ShieldCheck, Upload, Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AiAssistPanel } from "../../components/AiAssist";
import { Dropzone } from "../../components/chrome";
import { ModelBadge } from "../../components/DraftEditor";
import { HighlightedText, NlpInsights } from "../../components/nlp";
import { DocStateIcon, DocStatePill, IntentPill, StatusPill, UploaderBadge } from "../../components/status";
import { Avatar, Badge, Button, ErrorState, Field, Modal, PageSkeleton, ProgressRing, Tabs, stagger } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { dueLabel, fileSize, fmtDate, fmtDateTime, timeAgo } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { ChecklistItem, EnrolmentDetail as Detail, NlpMatch } from "../../lib/types";
import { SAMPLE_EMAIL, useNlpPreview } from "./NewEnrolment";

type Tab = "checklist" | "messages" | "history";

export default function EnrolmentDetail() {
  const { id = "" } = useParams();
  const { data, setData, error, loading, reload } = useApi<Detail>(`/api/admin/enrolments/${id}`, [id]);
  const [tab, setTab] = useState<Tab>("checklist");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [busy, setBusy] = useState("");

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Not found"} onRetry={reload} />;
  const { enrolment: e, checklist: cl } = data;
  const due = dueLabel(e.due_date);
  const closed = ["completed", "cancelled"].includes(e.status);
  const inviteUrl = data.invite?.status === "pending" ? `${location.origin}/invite/${data.invite.code}` : "";
  const unread = data.messages.filter((m) => m.direction === "from_customer" && !m.is_read).length;

  const act = async (key: string, fn: () => Promise<Detail>, success: string) => {
    setBusy(key);
    try { setData(await fn()); toast.success(success); } catch (err) { toast.error((err as ApiError).message); } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6">
      <Link to="/admin/enrolments" className="muted inline-flex items-center gap-1 text-sm hover:text-stone-900 dark:hover:text-white"><ArrowLeft className="h-4 w-4" /> Enrolments</Link>

      {/* header */}
      <motion.div {...stagger(0)} className="card card-pad">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Avatar name={e.customer_name} className="h-14 w-14 text-base" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-semibold tracking-tight">{e.customer_name}</h1><StatusPill status={e.status} /></div>
              <div className="muted mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span>{e.programme_name}</span><span>{e.enrolment_ref}</span>
                <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{e.customer_email}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{e.due_date ? <>Documents due {fmtDate(e.due_date)}{due && !closed && due.tone !== "slate" && <Badge tone={due.tone} className="ml-1">{due.text}</Badge>}</> : "No document deadline"}
                  {!closed && <button onClick={() => setDatesOpen(true)} className="ml-1 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10" title="Change the document deadline"><Pencil className="h-3 w-3" />{e.due_date ? "Change" : "Set deadline"}</button>}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.customer_has_login ? <Badge tone="emerald" dot>Portal active</Badge> : data.invite ? <Badge tone="amber" dot>Invite {data.invite.status}</Badge> : <Badge>No portal account</Badge>}
                {e.detected_service_code && e.detected_service_code !== e.programme_code && <Badge tone="amber">NLP: sounds like {e.detected_service_code}</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <ProgressRing value={cl.completion_pct} size={84} stroke={8}
              label={<div><div className="text-lg font-semibold tabular-nums">{cl.collected_count}/{cl.required_count}</div><div className="muted text-[10px]">collected</div></div>} />
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />{cl.verified_count} verified</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-sky-500" />{cl.collected_count - cl.verified_count} with staff</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-stone-300" />{cl.outstanding.length} outstanding</div>
            </div>
          </div>
        </div>
        {e.status === "cancelled" && (
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>Cancelled{e.cancelled_at ? ` ${fmtDate(e.cancelled_at)}` : ""}.</b> {e.cancellation_reason ? <>Reason shown to the customer: “{e.cancellation_reason}”</> : "No reason recorded."}</span>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-100 pt-4 dark:border-white/[0.06]">
          <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setIntakeOpen(true)} disabled={closed}>Paste customer message</Button>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy === "check"} disabled={closed}
            onClick={() => act("check", () => api.post(`/api/admin/enrolments/${e.id}/check`), "Checklist compared and saved")}>Re-check</Button>
          <Link to={`/admin/enrolments/${e.id}/trace`}><Button size="sm" variant="secondary" icon={<GitBranch className="h-4 w-4" />}>Pipeline trace</Button></Link>
          {inviteUrl && <Button size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success("Invite link copied"); }}>Copy invite link</Button>}
          {!data.customer_has_login && !data.invite && !closed && <Button size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} loading={busy === "invite"}
            onClick={async () => { setBusy("invite"); try { await api.post(`/api/admin/enrolments/${e.id}/invite`); reload(); toast.success("Invite created"); } catch (err) { toast.error((err as ApiError).message); } finally { setBusy(""); } }}>Create invite</Button>}
          <div className="ml-auto flex gap-2">
            {!closed && <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" icon={<Ban className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
            {!closed && <Button size="sm" variant="success" icon={<ShieldCheck className="h-4 w-4" />} disabled={!cl.all_verified} title={cl.all_verified ? "" : "All mandatory documents must be verified first"}
              onClick={() => setConfirmComplete(true)}>Complete onboarding</Button>}
          </div>
        </div>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-4">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: "checklist", label: "Checklist", count: cl.outstanding.length },
            { value: "messages", label: "Messages", count: unread },
            { value: "history", label: "Drafts & history", count: data.drafts.filter((d) => d.status === "draft").length },
          ]} />
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              {tab === "checklist" && <ChecklistPanel detail={data} onChange={setData} closed={closed} />}
              {tab === "messages" && <MessagesPanel detail={data} onChange={setData} />}
              {tab === "history" && <HistoryPanel detail={data} />}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <AiAssistPanel enrolmentId={e.id} disabled={e.status === "cancelled"} onDone={reload} />
        </div>
      </div>

      <IntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} detail={data} onApplied={(d) => { setData(d); setIntakeOpen(false); }} />
      <Modal open={confirmComplete} onClose={() => setConfirmComplete(false)} size="sm" title="Complete onboarding?"
        description="This marks the enrolment complete and notifies the customer. It can't be undone in the prototype."
        footer={<><Button variant="ghost" onClick={() => setConfirmComplete(false)}>Not yet</Button>
          <Button variant="success" loading={busy === "complete"} onClick={async () => { await act("complete", () => api.post(`/api/admin/enrolments/${e.id}/complete`), "Onboarding completed 🎉"); setConfirmComplete(false); }}>Yes, complete</Button></>}>
        <ul className="space-y-1.5 text-sm">{cl.items.filter((i) => i.is_mandatory).map((i) => <li key={i.doc_code} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{i.name}</li>)}</ul>
      </Modal>
      <DatesModal open={datesOpen} onClose={() => setDatesOpen(false)} enrolment={e} onDone={(d) => { setData(d); setDatesOpen(false); }} />
      <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} enrolmentId={e.id} onDone={(d) => { setData(d); setCancelOpen(false); }} />
    </div>
  );
}

/* ---------------------------------------------------------------- checklist */
function ChecklistPanel({ detail, onChange, closed }: { detail: Detail; onChange: (d: Detail) => void; closed: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (files: File[], docId?: number) => {
    setUploading(true);
    for (const f of files) {
      const form = new FormData(); form.append("file", f); if (docId) form.append("required_document_id", String(docId));
      try {
        const r = await api.upload<{ detail: Detail; submission: { doc_code: string | null; status: string } }>(`/api/admin/enrolments/${detail.enrolment.id}/uploads`, form);
        onChange(r.detail);
        toast.success(`${f.name} uploaded`, { description: r.submission.doc_code ? `Classified as ${r.submission.doc_code} · ${r.submission.status.replace("_", " ")}` : "Couldn't classify – please assign it" });
      } catch (e) { toast.error(`${f.name}: ${(e as ApiError).message}`); }
    }
    setUploading(false);
  };
  return (
    <div className="space-y-3">
      {detail.checklist.items.map((item, i) => (
        <ChecklistRow key={item.doc_code} item={item} index={i} detail={detail} open={open === item.doc_code}
          onToggle={() => setOpen(open === item.doc_code ? null : item.doc_code)} onChange={onChange} closed={closed} onUpload={(f) => upload(f, item.required_document_id)} />
      ))}
      {!closed && (
        <div className="pt-2">
          <Dropzone onFiles={(f) => upload(f)} disabled={uploading}>
            <div className="flex items-center gap-3 text-sm"><Upload className="h-5 w-5 text-brand-500" />
              <span><span className="font-medium">Upload on the customer's behalf</span><span className="muted block text-xs">Drop any file – NLP will work out which checklist item it is.</span></span></div>
          </Dropzone>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item, index, detail, open, onToggle, onChange, closed, onUpload }: {
  item: ChecklistItem; index: number; detail: Detail; open: boolean; onToggle: () => void; onChange: (d: Detail) => void; closed: boolean; onUpload: (f: File[]) => void;
}) {
  const sub = detail.submissions.find((s) => s.id === item.submission_id);
  const history = detail.submissions.filter((s) => s.required_document_id === item.required_document_id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const reviewable = !closed && sub && ["submitted", "needs_review"].includes(sub.status);
  const act = async (key: string, url: string, body?: unknown, msg?: string) => {
    setBusy(key); setErr("");
    try { onChange(await api.post<Detail>(url, body)); toast.success(msg ?? "Saved"); setRejecting(false); setReason(""); }
    catch (e) { const ae = e as ApiError; setErr(ae.fields.reason ?? ae.message); } finally { setBusy(""); }
  };
  return (
    <motion.div {...stagger(index)} layout className={clsx("card overflow-hidden transition", open && "ring-2 ring-brand-500/20")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left">
        <DocStateIcon state={item.state} className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.name}</span>{!item.is_mandatory && <Badge className="!py-0 text-[10px]">optional</Badge>}
            {sub && item.state !== "missing" && <UploaderBadge role={sub.uploaded_by_role} name={sub.uploaded_by_name} channel={sub.channel} />}</div>
          <div className="muted truncate text-xs">
            {item.filename ? <><FileText className="mr-1 inline h-3 w-3" />{item.filename} · {timeAgo(item.submitted_at)}</> : item.state === "missing" ? item.description : item.state_label}
            {item.expires_on && ` · valid until ${fmtDate(item.expires_on)}`}
          </div>
        </div>
        {typeof item.match_confidence === "number" && item.match_confidence > 0 && item.state !== "verified" && (
          <span className={clsx("hidden text-xs tabular-nums sm:block", item.match_confidence < 0.6 ? "text-amber-600" : "text-stone-400")}>{Math.round(item.match_confidence * 100)}% match</span>
        )}
        <DocStatePill state={item.state} />
        <ChevronDown className={clsx("h-4 w-4 text-stone-400 transition", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-4 border-t border-stone-100 px-4 pb-4 pt-4 dark:border-white/[0.06]">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div><div className="muted text-xs">What it is</div>{item.description}</div>
                <div><div className="muted text-xs">Why we need it</div>{item.why_needed || "—"}</div>
              </div>
              {item.rejection_reason && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/25"><span className="font-medium">Rejected:</span> {item.rejection_reason}</div>}
              {sub && (
                <div className="rounded-xl bg-stone-50 p-3 text-sm dark:bg-white/[0.03]">
                  <div className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">NLP evidence</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Source: <b className="font-medium">{sub.channel === "pasted_text" ? "customer message" : sub.channel === "upload" ? (sub.uploaded_by_role === "admin" ? `uploaded by staff${sub.uploaded_by_name ? ` (${sub.uploaded_by_name})` : ""}` : "uploaded by customer") : sub.channel}</b></span>
                    {sub.detected_doc_code && <span>Detected: <b className="font-medium">{sub.detected_doc_code}</b></span>}
                    {typeof sub.match_confidence === "number" && <span>Confidence: <b className="font-medium">{Math.round(sub.match_confidence * 100)}%</b></span>}
                    {sub.file_size ? <span>{fileSize(sub.file_size)}</span> : null}
                    {sub.customer_confirmed ? <Badge tone="emerald" className="!py-0">customer confirmed</Badge> : null}
                  </div>
                  {(sub.customer_note || sub.extracted_text) && <p className="muted mt-2 italic">“{sub.customer_note || sub.extracted_text?.slice(0, 240)}”</p>}
                  {sub.stored_path && <a href={`/api/admin/submissions/${sub.id}/file`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">Open file <ExternalLink className="h-3.5 w-3.5" /></a>}
                </div>
              )}
              {history.length > 1 && <div className="muted text-xs">{history.length} submissions for this item (latest shown).</div>}
              {err && <p className="text-sm text-rose-600">{err}</p>}
              <AnimatePresence>
                {rejecting && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <Field label="Reason (shown to the customer)"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The scan is blurry – please upload a clearer copy" /></Field>
                  </motion.div>
                )}
              </AnimatePresence>
              {!closed && (
                <div className="flex flex-wrap items-center gap-2">
                  {reviewable && !rejecting && <>
                    <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={busy === "verify"} onClick={() => act("verify", `/api/admin/submissions/${sub!.id}/verify`, {}, `${item.name} verified`)}>Verify</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" onClick={() => setRejecting(true)}>Reject…</Button>
                  </>}
                  {rejecting && <>
                    <Button size="sm" variant="danger" loading={busy === "reject"} onClick={() => act("reject", `/api/admin/submissions/${sub!.id}/reject`, { reason }, "Rejected – the customer will be notified")}>Confirm reject</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
                  </>}
                  <div className="ml-auto"><Dropzone compact onFiles={onUpload}><span className="flex items-center gap-1.5 text-xs font-medium"><Upload className="h-3.5 w-3.5" />Upload file for this item</span></Dropzone></div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* unassigned uploads hint */}
      {index === detail.checklist.items.length - 1 && <UnassignedUploads detail={detail} onChange={onChange} />}
    </motion.div>
  );
}

function UnassignedUploads({ detail, onChange }: { detail: Detail; onChange: (d: Detail) => void }) {
  const loose = detail.submissions.filter((s) => !s.required_document_id && s.status !== "superseded");
  if (!loose.length) return null;
  return (
    <div className="border-t border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
      <div className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">Unclassified uploads – assign them to a checklist item</div>
      {loose.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
          <FileText className="h-4 w-4 text-amber-600" />{s.original_filename}
          <select className="input ml-auto w-auto py-1.5 text-sm" defaultValue="" onChange={async (ev) => {
            try { onChange(await api.post<Detail>(`/api/admin/submissions/${s.id}/reassign`, { required_document_id: Number(ev.target.value) })); toast.success("Assigned"); }
            catch (e) { toast.error((e as ApiError).message); }
          }}>
            <option value="" disabled>Assign to…</option>
            {detail.checklist.items.map((i) => <option key={i.required_document_id} value={i.required_document_id}>{i.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- messages */
function MessagesPanel({ detail, onChange }: { detail: Detail; onChange: (d: Detail) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = async () => {
    setBusy(true); setErrors({});
    try { onChange(await api.post<Detail>(`/api/admin/enrolments/${detail.enrolment.id}/messages`, { subject, body })); setSubject(""); setBody(""); toast.success("Message posted to the customer's portal"); }
    catch (e) { setErrors((e as ApiError).fields); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="max-h-[520px] space-y-4 overflow-y-auto p-5">
        {detail.messages.length === 0 && <p className="muted py-8 text-center text-sm">No messages yet.</p>}
        {detail.messages.map((m, i) => {
          const mine = m.direction === "to_customer";
          return (
            <motion.div key={m.id} {...stagger(i)} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
              <div className={clsx("max-w-[85%] rounded-2xl px-4 py-3", mine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-stone-100 dark:bg-white/[0.06]")}>
                <div className={clsx("mb-1 flex flex-wrap items-center gap-2 text-xs", mine ? "text-white/70" : "muted")}>
                  <span className="font-medium">{mine ? (m.reminder_draft_id ? "Reminder (approved)" : m.author_name?.replace(/\s*\(.*\)/, "")) : m.author_name}</span>
                  <span>{fmtDateTime(m.created_at)}</span>{!mine && <IntentPill intent={m.nlp_intent} />}
                </div>
                <div className="text-sm font-semibold">{m.subject}</div>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-6">{m.body}</div>
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-stone-100 p-4 dark:border-white/[0.06]">
        <input className={clsx("input", errors.subject && "input-error")} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className={clsx("input min-h-[90px]", errors.body && "input-error")} placeholder="Write to the customer yourself (posts to their portal inbox)…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center justify-between"><span className="text-xs text-rose-600">{errors.subject || errors.body}</span>
          <Button size="sm" icon={<Send className="h-4 w-4" />} loading={busy} onClick={send} disabled={!body.trim()}>Send</Button></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- history */
function HistoryPanel({ detail }: { detail: Detail }) {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="border-b border-stone-100 px-5 py-3 text-sm font-semibold dark:border-white/[0.06]">Reminder drafts</div>
        {detail.drafts.length === 0 && <p className="muted p-6 text-center text-sm">No drafts yet – use AI Assist to create one.</p>}
        <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
          {detail.drafts.map((d) => (
            <Link key={d.id} to={`/admin/reviews?id=${d.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 transition hover:bg-stone-50 dark:hover:bg-white/[0.02]">
              <Wand2 className="h-4 w-4 text-violet-500" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{d.subject}</div><div className="muted text-xs">{fmtDateTime(d.created_at)} · {d.channel}</div></div>
              <ModelBadge d={d} />
              <Badge tone={d.status === "draft" ? "violet" : d.status === "published" ? "emerald" : "rose"}>{d.status}</Badge>
            </Link>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="border-b border-stone-100 px-5 py-3 text-sm font-semibold dark:border-white/[0.06]">Checklist snapshots</div>
        <div className="divide-y divide-stone-100 dark:divide-white/[0.05]">
          {detail.checks.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-28 tabular-nums">{Math.round(c.completion_pct)}% collected</span>
              <span className="muted flex-1">{c.trigger_reason.replace(/_/g, " ")}{c.status_before !== c.status_after && ` · ${c.status_before} → ${c.status_after}`}</span>
              <span className="text-xs text-stone-400">{fmtDateTime(c.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- intake + cancel */
function IntakeModal({ open, onClose, detail, onApplied }: { open: boolean; onClose: () => void; detail: Detail; onApplied: (d: Detail) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { analysis, loading } = useNlpPreview(open ? text : "", detail.enrolment.programme_id);
  const names = useMemo(() => Object.fromEntries(detail.checklist.items.map((i) => [i.doc_code, i.name])), [detail]);
  const apply = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.post<{ detail: Detail; created: NlpMatch[]; skipped: (NlpMatch & { reason: string })[]; unsupported: boolean }>(`/api/admin/enrolments/${detail.enrolment.id}/intake`, { text });
      onApplied(r.detail); setText("");
      toast.success(r.created.length ? `${r.created.length} checklist item(s) updated from the message` : "Message analysed – nothing new to record",
        { description: r.unsupported ? "It also contains an out-of-scope request – handle it personally." : r.skipped.length ? `${r.skipped.length} already on file` : undefined });
    } catch (e) { setErr((e as ApiError).fields.text ?? (e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Paste a customer message" description="The NLP pipeline extracts the service, documents sent and documents promised – then updates the checklist."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={apply} icon={<Wand2 className="h-4 w-4" />}>Apply to checklist</Button></>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between"><label className="label">Customer email / note</label>
            <button className="mb-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => setText(SAMPLE_EMAIL)}>Use sample</button></div>
          <textarea autoFocus className={clsx("input min-h-[180px] leading-6", err && "input-error")} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the email here…" />
          {err && <p className="mt-1.5 text-sm text-rose-600">{err}</p>}
          {analysis && text.trim() && <div className="mt-3 rounded-xl bg-stone-50 p-3 dark:bg-white/[0.03]"><HighlightedText text={text} highlights={analysis.highlights} names={names} /></div>}
        </div>
        <div><label className="label">Live extraction</label><NlpInsights analysis={analysis} loading={loading} programmeCode={detail.enrolment.programme_code} /></div>
      </div>
    </Modal>
  );
}

function CancelModal({ open, onClose, enrolmentId, onDone }: { open: boolean; onClose: () => void; enrolmentId: number; onDone: (d: Detail) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Cancel this enrolment?" description="The checklist is frozen and the customer is notified. They keep their account."
      footer={<><Button variant="ghost" onClick={onClose}>Keep it</Button><Button variant="danger" loading={busy} onClick={async () => {
        setBusy(true); setErr("");
        try { onDone(await api.post<Detail>(`/api/admin/enrolments/${enrolmentId}/cancel`, { reason })); toast("Enrolment cancelled"); }
        catch (e) { setErr((e as ApiError).fields.reason ?? (e as ApiError).message); } finally { setBusy(false); }
      }}>Cancel enrolment</Button></>}>
      <Field label="Reason" error={err}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      <div className="mt-2 flex items-center gap-1 text-xs text-stone-400"><Copy className="h-3 w-3" />The customer sees this reason in their portal. It is also recorded in the audit log.</div>
    </Modal>
  );
}

function DatesModal({ open, onClose, enrolment, onDone }: { open: boolean; onClose: () => void; enrolment: { id: number; due_date: string | null; target_start_date: string | null }; onDone: (d: Detail) => void }) {
  const [due, setDue] = useState("");
  const [start, setStart] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDue(enrolment.due_date ?? ""); setStart(enrolment.target_start_date ?? ""); setErrors({}); } }, [open, enrolment.due_date, enrolment.target_start_date]);
  const save = async () => {
    if (due && start && due > start) { setErrors({ due_date: "The document deadline should be before the start date." }); return; }
    setBusy(true); setErrors({});
    try {
      onDone(await api.patch<Detail>(`/api/admin/enrolments/${enrolment.id}`, { due_date: due || null, target_start_date: start || null }));
      toast.success(due ? `Deadline set to ${fmtDate(due)}` : "Deadline removed", { description: "The customer sees the new date in their portal." });
    } catch (err) { const ae = err as ApiError; setErrors(ae.fields); if (!Object.keys(ae.fields).length) toast.error(ae.message); } finally { setBusy(false); }
  };
  const quick = (days: number) => setDue(new Date(Date.now() + days * 86400000).toISOString().slice(0, 10));
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Document deadline" description="The date by which the customer must upload every required document."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save dates</Button></>}>
      <div className="space-y-4">
        <Field label="Documents due by" error={errors.due_date}>
          <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {[7, 14, 21, 30].map((d) => <button key={d} type="button" onClick={() => quick(d)} className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:hover:text-brand-200">+{d} days</button>)}
          {due && <button type="button" onClick={() => setDue("")} className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:text-rose-600">Clear</button>}
        </div>
        <Field label="Programme start date (optional)" error={errors.target_start_date}>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <p className="muted flex items-center gap-1 text-xs"><Copy className="h-3 w-3" />Changes are recorded in the audit log.</p>
      </div>
    </Modal>
  );
}
