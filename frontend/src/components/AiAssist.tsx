import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Bot, Check, FileWarning, KeyRound, ListChecks, Loader2, MailPlus, Sparkles, User2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, setDemoCode } from "../lib/api";
import { useApi } from "../lib/hooks";
import type { AiResult, AiStep, Draft } from "../lib/types";
import { DraftEditor } from "./DraftEditor";
import { Badge, Button, Field, Modal, Segmented } from "./ui";

const PIPELINE = [
  { name: "read_enrolment", label: "Read enrolment" },
  { name: "compare_checklist", label: "Compare checklist" },
  { name: "nlp_evidence", label: "NLP evidence" },
  { name: "build_prompt", label: "Build prompt" },
  { name: "llm_call", label: "LLM API" },
  { name: "validate", label: "Validate & ground" },
  { name: "save", label: "Save to database" },
];

function PipelineSteps({ running, steps }: { running: boolean; steps: AiStep[] | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    setTick(0);
    const t = setInterval(() => setTick((x) => Math.min(x + 1, 4)), 450);
    return () => clearInterval(t);
  }, [running]);
  const list: { name: string; label: string; status: string; detail: string | null; ms: number }[] = steps
    ? steps
    : PIPELINE.map((p, i) => ({ ...p, status: i < tick ? "ok" : i === tick ? "running" : "waiting", detail: null, ms: 0 }));
  return (
    <ol className="space-y-1.5">
      {list.map((s, i) => {
        const state = s.status;
        return (
          <motion.li key={s.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex items-start gap-2.5 text-[13px]">
            <span className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              state === "ok" ? "bg-emerald-500 text-white" : state === "error" ? "bg-amber-500 text-white" : state === "running" ? "bg-brand-100 text-brand-600 dark:bg-brand-500/20" : "bg-stone-100 dark:bg-white/[0.06]")}>
              {state === "ok" ? <Check className="h-3 w-3" /> : state === "error" ? <AlertTriangle className="h-3 w-3" /> : state === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className={clsx("font-medium", state === "waiting" && "text-stone-400")}>{s.label}</span>
              {s.detail && <span className="muted block truncate text-xs" title={s.detail}>{s.detail}</span>}
            </span>
            {!!s.ms && <span className="text-[11px] tabular-nums text-stone-400">{s.ms} ms</span>}
          </motion.li>
        );
      })}
    </ol>
  );
}

export function AiAssistPanel({ enrolmentId, disabled, onDone }: { enrolmentId: number; disabled?: boolean; onDone: () => void }) {
  const provider = useApi<{ provider_label: string; model: string }>("/api/admin/llm/status").data?.provider_label;
  const [tone, setTone] = useState<"friendly" | "formal">("friendly");
  const [channel, setChannel] = useState<"portal" | "email" | "sms">("portal");
  const [running, setRunning] = useState<"" | "explain_outstanding" | "draft_reminder">("");
  const [result, setResult] = useState<AiResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>("");
  const [needCode, setNeedCode] = useState<null | "explain" | "reminder">(null);
  const [code, setCode] = useState("");

  const run = async (kind: "explain" | "reminder") => {
    setRunning(kind === "explain" ? "explain_outstanding" : "draft_reminder"); setResult(null); setDraft(null); setError("");
    try {
      const r = await api.post<AiResult>(`/api/admin/enrolments/${enrolmentId}/ai/${kind}`, { tone, channel });
      setResult(r);
      if (r.draft_id) {
        const d = await api.get<{ draft: Draft }>(`/api/admin/drafts/${r.draft_id}`);
        setDraft(d.draft);
      }
      onDone();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403 && err.details?.demo_code) setNeedCode(kind);
      else setError(err.message);
    } finally { setRunning(""); }
  };

  const out = result?.output;
  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden border-b border-stone-100 bg-gradient-to-br from-brand-500 via-accent-500 to-accent-700 px-5 py-4 text-white dark:border-white/[0.06]">
        <div className="absolute -right-6 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-center gap-2"><Sparkles className="h-5 w-5" /><h3 className="font-semibold">AI Assist</h3>
          <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[11px]">{provider ?? "AI"} · human-reviewed</span></div>
        <p className="relative mt-1 text-[13px] text-white/75">Grounded in this checklist. Drafts are never sent automatically.</p>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-3">
          <div><div className="muted mb-1 text-[11px] font-medium uppercase tracking-wide">Tone</div>
            <Segmented size="sm" value={tone} onChange={setTone} options={[{ value: "friendly", label: "Friendly" }, { value: "formal", label: "Formal" }]} /></div>
          <div><div className="muted mb-1 text-[11px] font-medium uppercase tracking-wide">Channel</div>
            <Segmented size="sm" value={channel} onChange={setChannel} options={[{ value: "portal", label: "Portal" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }]} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={<ListChecks className="h-4 w-4" />} loading={running === "explain_outstanding"} disabled={!!running || disabled} onClick={() => run("explain")}>Explain steps</Button>
          <Button icon={<MailPlus className="h-4 w-4" />} loading={running === "draft_reminder"} disabled={!!running || disabled} onClick={() => run("reminder")}>Draft reminder</Button>
        </div>

        <AnimatePresence mode="wait">
          {(running || result) && (
            <motion.div key={running ? "running" : "done"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-xl bg-stone-50 p-3.5 dark:bg-white/[0.03]">
              <div className="muted mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
                <span>Pipeline</span>{result && <span className="normal-case tracking-normal">{result.steps.reduce((a, s) => a + s.ms, 0)} ms total</span>}
              </div>
              <PipelineSteps running={!!running} steps={result?.steps ?? null} />
            </motion.div>
          )}
        </AnimatePresence>

        {error && <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25">{error}</div>}

        {result && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {result.is_fallback ? (
              <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <div><span className="font-medium">Template fallback – not AI.</span> {result.interaction.error ?? result.validation.errors[0] ?? "AI output failed validation."}</div>
              </div>
            ) : (
              <Badge tone="violet" icon={<Bot className="h-3 w-3" />}>
                {result.interaction.model} · {(result.interaction.latency_ms / 1000).toFixed(1)}s · {result.interaction.input_tokens}→{result.interaction.output_tokens} tokens
                {result.interaction.attempts > 1 ? " · repaired once" : ""}
              </Badge>
            )}
            {result.task === "explain_outstanding" && out && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge tone={out.risk_level === "high" ? "rose" : out.risk_level === "medium" ? "amber" : "emerald"} dot>{out.risk_level} risk</Badge>
                  <span className="muted truncate text-xs">{out.risk_reason}</span>
                </div>
                <p className="text-sm leading-6">{out.summary}</p>
                <ul className="space-y-2">
                  {out.steps.map((s: { doc_code: string; owner: string; action: string; reason: string }, i: number) => (
                    <motion.li key={s.doc_code + i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="flex gap-2.5 rounded-xl border border-stone-100 p-2.5 dark:border-white/[0.06]">
                      <span className={clsx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", s.owner === "customer" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300")}>
                        <User2 className="h-3.5 w-3.5" />
                      </span>
                      <div className="text-[13px]"><div className="font-medium">{s.action}</div><div className="muted">{s.reason}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wide text-stone-400">{s.owner} · {s.doc_code}</div></div>
                    </motion.li>
                  ))}
                </ul>
                <div className="rounded-xl bg-brand-50 p-3 text-[13px] text-brand-900 dark:bg-brand-500/10 dark:text-brand-200"><span className="font-medium">Next: </span>{out.officer_next_action}</div>
              </div>
            )}
            {draft && <DraftEditor draft={draft} onChanged={(d) => { setDraft(d); onDone(); }} />}
          </motion.div>
        )}
      </div>

      <Modal open={!!needCode} onClose={() => setNeedCode(null)} size="sm" title="Demo access code" description="This public demo protects the AI features with a shared code."
        footer={<><Button variant="ghost" onClick={() => setNeedCode(null)}><X className="h-4 w-4" />Cancel</Button>
          <Button icon={<KeyRound className="h-4 w-4" />} onClick={() => { setDemoCode(code); const k = needCode!; setNeedCode(null); run(k); }}>Unlock</Button></>}>
        <Field label="Access code"><input className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
