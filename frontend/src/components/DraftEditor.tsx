import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Bot, CheckCircle2, Copy, FileWarning, Send, ShieldCheck, Undo2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Draft } from "../lib/types";
import { Badge, Button, Field } from "./ui";

export function ModelBadge({ d }: { d: Pick<Draft, "is_fallback" | "model" | "latency_ms" | "input_tokens" | "output_tokens" | "prompt_version" | "llm_status"> }) {
  if (d.is_fallback) {
    return <Badge tone="amber" icon={<FileWarning className="h-3 w-3" />}>Template – not AI{d.llm_status && d.llm_status !== "fallback" ? ` (${d.llm_status.replace("_", " ")})` : ""}</Badge>;
  }
  return (
    <Badge tone="violet" icon={<Bot className="h-3 w-3" />}>
      {d.model ?? "AI"}{d.latency_ms ? ` · ${(d.latency_ms / 1000).toFixed(1)}s` : ""}{d.input_tokens ? ` · ${d.input_tokens}→${d.output_tokens} tok` : ""}{d.prompt_version ? ` · ${d.prompt_version}` : ""}
    </Badge>
  );
}

/** Human-in-the-loop review: edit, then publish to the customer portal or reject. */
export function DraftEditor({ draft, onChanged }: { draft: Draft; onChanged: (d: Draft | null) => void }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "publish" | "reject">("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setSubject(draft.subject); setBody(draft.body); setRejecting(false); setReason(""); setErrors({}); }, [draft.id, draft.subject, draft.body]);

  const dirty = subject !== draft.subject || body !== draft.body;
  const editable = draft.status === "draft";
  const words = body.trim().split(/\s+/).filter(Boolean).length;

  const save = async () => {
    setBusy("save"); setErrors({});
    try { const r = await api.patch<{ draft: Draft }>(`/api/admin/drafts/${draft.id}`, { subject, body }); onChanged(r.draft); toast.success("Draft saved"); return true; }
    catch (e) { setErrors((e as ApiError).fields); toast.error((e as ApiError).message); return false; }
    finally { setBusy(""); }
  };
  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy("publish");
    try {
      const r = await api.post<{ draft: Draft; notice?: string }>(`/api/admin/drafts/${draft.id}/publish`, {});
      onChanged(r.draft);
      toast.success("Published to the customer's portal inbox", { description: r.notice });
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(""); }
  };
  const reject = async () => {
    setBusy("reject"); setErrors({});
    try { const r = await api.post<{ draft: Draft }>(`/api/admin/drafts/${draft.id}/reject`, { reason }); onChanged(r.draft); toast("Draft rejected"); }
    catch (e) { setErrors((e as ApiError).fields); } finally { setBusy(""); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ModelBadge d={draft} />
        <Badge>{draft.channel.toUpperCase()} · {draft.tone}</Badge>
        {draft.status === "published" && <Badge tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />}>Published {fmtDateTime(draft.published_at)}</Badge>}
        {draft.status === "rejected" && <Badge tone="rose" icon={<XCircle className="h-3 w-3" />}>Rejected</Badge>}
        {draft.body !== draft.original_body && <Badge tone="sky">Edited by officer</Badge>}
      </div>

      {!!draft.validation?.warnings?.length && editable && (
        <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" /> Check before publishing</div>
          <ul className="ml-5 list-disc space-y-0.5">{draft.validation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {!!draft.validation?.errors?.length && draft.is_fallback === 1 && (
        <div className="rounded-xl bg-stone-50 p-3 text-[13px] ring-1 ring-stone-200 dark:bg-white/[0.03] dark:ring-white/10">
          <div className="mb-1 font-medium">Why the AI draft was replaced by a template</div>
          <ul className="muted ml-5 list-disc space-y-0.5">{draft.validation.errors.slice(0, 4).map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <Field label="Subject" error={errors.subject}>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} />
      </Field>
      <Field label="Message" error={errors.body}>
        <textarea className="input min-h-[260px] resize-y font-[450] leading-6" value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} />
      </Field>
      <div className="muted flex items-center justify-between text-xs">
        <span>{words} words · {body.length} characters{draft.channel === "sms" && body.length > 320 ? " · long for SMS" : ""}</span>
        <span className="flex gap-3">
          {editable && body !== draft.original_body && <button className="flex items-center gap-1 hover:text-stone-700 dark:hover:text-stone-200" onClick={() => setBody(draft.original_body)}><Undo2 className="h-3.5 w-3.5" />Restore original</button>}
          <button className="flex items-center gap-1 hover:text-stone-700 dark:hover:text-stone-200" onClick={() => { navigator.clipboard.writeText(`${subject}\n\n${body}`); toast.success("Copied to clipboard"); }}><Copy className="h-3.5 w-3.5" />Copy</button>
        </span>
      </div>

      {editable && (
        <>
          <AnimatePresence>
            {rejecting && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <Field label="Why are you rejecting this draft?" error={errors.reason}>
                  <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tone too pushy, customer already called us" />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4 dark:border-white/[0.06]">
            <div className="muted mr-auto flex items-center gap-1.5 text-xs"><ShieldCheck className="h-4 w-4 text-emerald-500" />Nothing is sent until you publish.</div>
            {rejecting
              ? <><Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" loading={busy === "reject"} onClick={reject}>Reject draft</Button></>
              : <>
                  <Button variant="ghost" onClick={() => setRejecting(true)}>Reject</Button>
                  {dirty && <Button variant="secondary" loading={busy === "save"} onClick={save}>Save edits</Button>}
                  <Button variant="success" icon={<Send className="h-4 w-4" />} loading={busy === "publish"} onClick={publish}>Approve & publish</Button>
                </>}
          </div>
        </>
      )}
      {draft.status !== "draft" && draft.review_note && <p className="muted text-sm">Review note: {draft.review_note}</p>}
    </div>
  );
}
