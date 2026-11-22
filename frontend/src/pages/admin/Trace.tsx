import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bot, Brain, ChevronDown, ClipboardCheck, MessageCircle, Wand2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { IntentPill } from "../../components/status";
import { Badge, ErrorState, PageSkeleton, Segmented, stagger } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { Enrolment } from "../../lib/types";

type Ev = { type: "nlp" | "check" | "llm" | "draft" | "message"; id: number; at: string; [k: string]: any };
const META = {
  nlp: { icon: Brain, label: "NLP extraction", color: "bg-sky-500" },
  check: { icon: ClipboardCheck, label: "Checklist comparison", color: "bg-emerald-500" },
  llm: { icon: Bot, label: "Claude API call", color: "bg-violet-500" },
  draft: { icon: Wand2, label: "Reminder draft", color: "bg-fuchsia-500" },
  message: { icon: MessageCircle, label: "Portal message", color: "bg-amber-500" },
};

function Json({ value }: { value: unknown }) {
  return <pre className="scrollbar-thin max-h-80 overflow-auto rounded-xl bg-stone-950 p-3 text-[11.5px] leading-5 text-stone-200">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

function Body({ e }: { e: Ev }) {
  if (e.type === "nlp") return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2"><Badge>{e.source.replace("_", " ")}</Badge><IntentPill intent={e.intent} />
        {e.detected_service?.code && <Badge tone="brand">service: {e.detected_service.code} ({Math.round(e.detected_service.score * 100)}%)</Badge>}<Badge>{e.pipeline_version}</Badge></div>
      <div><div className="muted mb-1 text-xs">Input (PII-masked)</div><p className="rounded-xl bg-stone-50 p-3 italic dark:bg-white/[0.03]">{e.input_excerpt}</p></div>
      <div><div className="muted mb-1 text-xs">Tokens</div><div className="flex flex-wrap gap-1">{e.tokens.map((t: string, i: number) => <code key={i} className="rounded bg-stone-100 px-1.5 text-[11px] dark:bg-white/[0.06]">{t}</code>)}</div></div>
      <div><div className="muted mb-1 text-xs">Document matches</div><Json value={e.matches} /></div>
      <div><div className="muted mb-1 text-xs">Entities</div><Json value={e.entities} /></div>
    </div>
  );
  if (e.type === "check") return (
    <div className="space-y-2 text-sm">
      <div>{e.collected}/{e.required} collected · {e.verified} verified · {Math.round(e.completion_pct)}% · status {e.status_before} → <b>{e.status_after}</b> <span className="muted">({e.reason.replace(/_/g, " ")})</span></div>
      {e.missing.length > 0 && <div className="flex flex-wrap gap-1.5">{e.missing.map((m: any) => <Badge key={m.doc_code} tone="amber">{m.name}: {m.state}</Badge>)}</div>}
    </div>
  );
  if (e.type === "llm") return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge tone={e.status === "success" ? "emerald" : "amber"} dot>{e.status}</Badge><Badge>{e.provider} · {e.model}</Badge><Badge>prompt {e.prompt_version}</Badge>
        {e.latency_ms ? <Badge>{e.latency_ms} ms</Badge> : null}{e.input_tokens ? <Badge>{e.input_tokens}→{e.output_tokens} tokens</Badge> : null}<Badge>{e.attempts} attempt(s)</Badge>
        {e.request_id && <Badge tone="slate">{e.request_id}</Badge>}
      </div>
      {e.error && <p className="text-amber-700 dark:text-amber-300">{e.error}</p>}
      {(e.validation?.errors?.length > 0 || e.validation?.warnings?.length > 0) && <div><div className="muted mb-1 text-xs">Validation</div><Json value={e.validation} /></div>}
      <details className="group"><summary className="cursor-pointer text-xs font-medium text-brand-600 dark:text-brand-300">System prompt</summary><div className="mt-2"><Json value={e.request?.system} /></div></details>
      <details open><summary className="cursor-pointer text-xs font-medium text-brand-600 dark:text-brand-300">User prompt (grounded context)</summary><div className="mt-2"><Json value={e.request?.user} /></div></details>
      {e.response_text && <details><summary className="cursor-pointer text-xs font-medium text-brand-600 dark:text-brand-300">Raw response</summary><div className="mt-2"><Json value={e.response_text} /></div></details>}
      <div><div className="muted mb-1 text-xs">Final output (saved)</div><Json value={e.parsed} /></div>
    </div>
  );
  if (e.type === "draft") return <div className="text-sm">“{e.subject}” · <Badge tone={e.status === "published" ? "emerald" : e.status === "draft" ? "violet" : "rose"}>{e.status}</Badge>{e.is_fallback ? <Badge tone="amber" className="ml-2">template</Badge> : null} <span className="muted">from llm_interactions #{e.llm_interaction_id}</span></div>;
  return <div className="text-sm">{e.direction === "to_customer" ? "To customer" : "From customer"} · “{e.subject}” {e.intent && <IntentPill intent={e.intent} />}</div>;
}

export default function Trace() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useApi<{ enrolment: Enrolment; events: Ev[] }>(`/api/admin/enrolments/${id}/trace`, [id]);
  const [filter, setFilter] = useState<"all" | "nlp" | "check" | "llm">("all");
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Error"} onRetry={reload} />;
  const events = data.events.filter((e) => filter === "all" || e.type === filter);
  const firstLlm = data.events.find((e) => e.type === "llm");
  return (
    <div className="space-y-5">
      <Link to={`/admin/enrolments/${id}`} className="muted inline-flex items-center gap-1 text-sm hover:text-stone-900 dark:hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to workspace</Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="h-page">Pipeline trace</h1><p className="muted mt-1 text-sm">{data.enrolment.customer_name} · {data.enrolment.programme_name} · {data.enrolment.enrolment_ref}. Every NLP result, checklist snapshot and API request/response stored for this enrolment.</p></div>
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "nlp", label: "NLP" }, { value: "check", label: "Checks" }, { value: "llm", label: "LLM" }]} />
      </div>
      <ol className="relative space-y-3 pl-8">
        <span className="absolute bottom-2 left-[13px] top-2 w-px bg-stone-200 dark:bg-white/10" />
        {events.map((e, i) => {
          const m = META[e.type]; const key = `${e.type}-${e.id}`;
          const isOpen = open === key || (open === null && e === firstLlm);
          return (
            <motion.li key={key} {...stagger(i)} className="relative">
              <span className={clsx("absolute -left-8 top-3 flex h-7 w-7 items-center justify-center rounded-full text-white ring-4 ring-stone-50 dark:ring-[#160b14]", m.color)}><m.icon className="h-3.5 w-3.5" /></span>
              <div className="card">
                <button onClick={() => setOpen(isOpen ? "" : key)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="text-sm font-medium">{m.label}</span>
                  {e.type === "llm" && <span className="muted text-xs">{e.task.replace("_", " ")}</span>}
                  {e.type === "nlp" && <span className="muted text-xs">{e.matches.length} match(es)</span>}
                  <span className="ml-auto text-xs tabular-nums text-stone-400">{fmtDateTime(e.at)}</span>
                  <span className="font-mono text-[11px] text-stone-400">#{e.id}</span>
                  <ChevronDown className={clsx("h-4 w-4 text-stone-400 transition", isOpen && "rotate-180")} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="border-t border-stone-100 p-4 dark:border-white/[0.06]"><Body e={e} /></div></motion.div>}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
