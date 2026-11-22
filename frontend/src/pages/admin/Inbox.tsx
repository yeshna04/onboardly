import clsx from "clsx";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Inbox as InboxIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { IntentPill } from "../../components/status";
import { Avatar, EmptyState, ErrorState, Skeleton, stagger } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Message } from "../../lib/types";

export default function Inbox() {
  const { data, setData, error, loading, reload } = useApi<{ items: (Message & { nlp_matches_json?: string })[] }>("/api/admin/messages/inbound");
  const markRead = async (id: number) => {
    await api.post(`/api/admin/messages/${id}/read`).catch(() => undefined);
    setData((d) => d && { items: d.items.map((m) => (m.id === id ? { ...m, is_read: 1 } : m)) });
  };
  return (
    <div className="space-y-5">
      <div><h1 className="h-page">Customer inbox</h1><p className="muted mt-1 text-sm">Replies from the customer portal. NLP tags each message's intent so you can triage quickly.</p></div>
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
      {data?.items.length === 0 && <div className="card"><EmptyState icon={<InboxIcon className="h-6 w-6" />} title="No customer messages yet" /></div>}
      <div className="space-y-3">
        {data?.items.map((m, i) => {
          const matches: { name: string; cue: string }[] = (() => { try { return JSON.parse(m.nlp_matches_json ?? "[]"); } catch { return []; } })();
          return (
            <motion.div key={m.id} {...stagger(i)} onMouseEnter={() => !m.is_read && markRead(m.id)}
              className={clsx("card card-pad relative", !m.is_read && "ring-2 ring-brand-500/25")}>
              {!m.is_read && <span className="absolute right-5 top-5 h-2.5 w-2.5 rounded-full bg-brand-500" />}
              <div className="flex items-start gap-3">
                <Avatar name={m.customer_name ?? "?"} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{m.customer_name}</span><IntentPill intent={m.nlp_intent} /><span className="muted text-xs">{fmtDateTime(m.created_at)}</span></div>
                  <div className="muted text-xs">{m.programme_name} · {m.enrolment_ref}</div>
                  <div className="mt-2 text-sm font-medium">{m.subject}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{m.body}</p>
                  {matches.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {matches.map((x) => <span key={x.name} className="rounded-md bg-stone-100 px-2 py-0.5 text-xs dark:bg-white/[0.06]">{x.name} · {x.cue === "pending" ? "will follow" : x.cue}</span>)}
                    </div>
                  )}
                  {m.nlp_intent === "unsupported" && <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400"><AlertTriangle className="h-3.5 w-3.5" />Out-of-scope request – the assistant won't act on it; reply personally.</p>}
                  <Link to={`/admin/enrolments/${m.enrolment_id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">Open workspace <ArrowRight className="h-4 w-4" /></Link>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
