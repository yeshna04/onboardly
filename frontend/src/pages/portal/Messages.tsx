import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox, Lock, Send, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, Button, EmptyState, ErrorState, PageSkeleton } from "../../components/ui";
import { useDemoGate } from "../../components/DemoGate";
import { api, ApiError } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Message } from "../../lib/types";

export default function Messages() {
  const { data, setData, error, loading, reload } = useApi<{ items: Message[] }>("/api/portal/messages");
  const { data: overview } = useApi<{ enrolments: { id: number; programme_name: string }[] }>("/api/portal/overview");
  const [enrolmentId, setEnrolmentId] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const demo = useDemoGate();
  useEffect(() => { if (overview?.enrolments.length && !enrolmentId) setEnrolmentId(overview.enrolments[0].id); }, [overview, enrolmentId]);
  useEffect(() => { if (data?.items.some((m) => m.direction === "to_customer" && !m.is_read)) api.post("/api/portal/messages/read").catch(() => undefined); }, [data]);
  const thread = useMemo(() => [...(data?.items ?? [])].filter((m) => !enrolmentId || m.enrolment_id === enrolmentId).reverse(), [data, enrolmentId]);

  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;

  const send = async () => {
    if (!enrolmentId || demo.block("send messages")) return;
    setBusy(true); setErr("");
    try { const r = await api.post<{ items: Message[] }>(`/api/portal/enrolments/${enrolmentId}/messages`, { body }); setData(r); setBody(""); toast.success("Sent to your onboarding team"); }
    catch (e) { if (demo.handleError(e)) return; setErr((e as ApiError).fields.body ?? (e as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-semibold tracking-tight">Messages</h1><p className="muted mt-1 text-sm">Every message here has been written or approved by a member of our team.</p></div>
        {(overview?.enrolments.length ?? 0) > 1 && (
          <select className="input w-auto" value={enrolmentId ?? ""} onChange={(e) => setEnrolmentId(Number(e.target.value))}>
            {overview!.enrolments.map((e) => <option key={e.id} value={e.id}>{e.programme_name}</option>)}
          </select>
        )}
      </div>
      <div className="card flex h-[calc(100vh-260px)] min-h-[420px] flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {thread.length === 0 && <EmptyState icon={<Inbox className="h-6 w-6" />} title="No messages yet">Questions about your documents? Send us a message below.</EmptyState>}
          <AnimatePresence initial={false}>
            {thread.map((m) => {
              const mine = m.direction === "from_customer";
              return (
                <motion.div key={m.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={clsx("flex gap-3", mine && "flex-row-reverse")}>
                  {!mine && <Avatar name="Onboarding Team" className="h-8 w-8" />}
                  <div className={clsx("max-w-[80%] rounded-2xl px-4 py-3", mine ? "rounded-tr-md bg-brand-600 text-white" : "rounded-tl-md bg-stone-100 dark:bg-white/[0.06]")}>
                    <div className={clsx("mb-1 flex items-center gap-2 text-xs", mine ? "text-white/70" : "muted")}>
                      <span className="font-medium">{mine ? "You" : "Onboarding team"}</span><span>{fmtDateTime(m.created_at)}</span>
                      {!mine && <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-label="Approved by staff" />}
                    </div>
                    {!mine && m.reminder_draft_id && <div className="text-sm font-semibold">{m.subject}</div>}
                    <div className="whitespace-pre-wrap text-sm leading-6">{m.body}</div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <div className="border-t border-stone-100 p-4 dark:border-white/[0.06]">
          <div className="flex gap-2">
            <textarea className={clsx("input min-h-[48px] flex-1 resize-none", err && "input-error")} rows={2} placeholder={demo.isDemo ? "Messaging is off on the demo account – create your own account to chat with the team." : "Ask a question or tell us when a document will arrive…"}
              value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) send(); }} />
            <Button className="self-end" icon={demo.isDemo ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />} loading={busy} disabled={!demo.isDemo && !body.trim()} onClick={send}>Send</Button>
          </div>
          {err ? <p className="mt-1.5 text-sm text-rose-600">{err}</p> : <p className="muted mt-1.5 text-xs">⌘/Ctrl + Enter to send</p>}
        </div>
      </div>
    </div>
  );
}
