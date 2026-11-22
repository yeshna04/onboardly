import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Brain, CalendarDays, Clock, FileCheck2, Sparkles, Target } from "lucide-react";
import type { NlpAnalysis, NlpHighlight } from "../lib/types";
import { Badge, Spinner } from "./ui";
import { IntentPill } from "./status";

const DOC_COLORS = [
  "bg-sky-100 text-sky-900 ring-sky-300 dark:bg-sky-500/20 dark:text-sky-100 dark:ring-sky-500/40",
  "bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-500/40",
  "bg-violet-100 text-violet-900 ring-violet-300 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-violet-500/40",
  "bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300 dark:bg-fuchsia-500/20 dark:text-fuchsia-100 dark:ring-fuchsia-500/40",
  "bg-teal-100 text-teal-900 ring-teal-300 dark:bg-teal-500/20 dark:text-teal-100 dark:ring-teal-500/40",
  "bg-indigo-100 text-indigo-900 ring-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-100 dark:ring-indigo-500/40",
];

/** Render the user's text with NLP matches highlighted inline. */
export function HighlightedText({ text, highlights, names }: { text: string; highlights: NlpHighlight[]; names: Record<string, string> }) {
  const codes = [...new Set(highlights.filter((h) => h.doc_code).map((h) => h.doc_code!))];
  const parts: JSX.Element[] = [];
  let pos = 0;
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  sorted.forEach((h, i) => {
    if (h.start < pos) return; // overlapping – keep the earlier one
    if (h.start > pos) parts.push(<span key={`t${i}`}>{text.slice(pos, h.start)}</span>);
    const color = h.kind === "pending_cue"
      ? "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-100 dark:ring-amber-500/40"
      : DOC_COLORS[codes.indexOf(h.doc_code!) % DOC_COLORS.length];
    parts.push(
      <mark key={`h${i}`} title={h.kind === "pending_cue" ? "Promise / later" : names[h.doc_code!] ?? h.doc_code!}
        className={clsx("rounded-md px-0.5 ring-1 ring-inset transition-colors", color)}>
        {text.slice(h.start, h.end)}
        {h.kind === "document" && <sup className="ml-0.5 text-[9px] font-semibold uppercase tracking-wide opacity-70">{(names[h.doc_code!] ?? h.doc_code!).split(" ")[0]}</sup>}
      </mark>,
    );
    pos = h.end;
  });
  if (pos < text.length) parts.push(<span key="end">{text.slice(pos)}</span>);
  return <div className="whitespace-pre-wrap break-words text-sm leading-7">{parts}</div>;
}

export function NlpInsights({ analysis, loading, programmeCode }: { analysis: NlpAnalysis | null; loading?: boolean; programmeCode?: string }) {
  if (!analysis) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-stone-200 p-4 text-sm text-stone-500 dark:border-white/10">
        {loading ? <Spinner /> : <Brain className="h-4 w-4" />} {loading ? "Analysing…" : "Start typing – the NLP pipeline reads the text live."}
      </div>
    );
  }
  const svc = analysis.detected_service;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <IntentPill intent={analysis.intent.label} />
        {svc.code ? (
          <Badge tone={programmeCode && svc.code !== programmeCode ? "amber" : "brand"} icon={<Target className="h-3 w-3" />}>
            Service: {svc.name} · {(svc.score * 100).toFixed(0)}%
          </Badge>
        ) : <Badge icon={<Target className="h-3 w-3" />}>Service: unclear</Badge>}
        <Badge icon={<Sparkles className="h-3 w-3" />}>{analysis.token_count} tokens · {analysis.sentence_count} sentences</Badge>
        {loading && <Spinner className="text-stone-400" />}
      </div>

      <AnimatePresence>
        {analysis.warnings.map((w) => (
          <motion.div key={w} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="flex gap-2 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {analysis.document_matches.length === 0 && <p className="muted text-sm">No checklist documents detected yet.</p>}
          {analysis.document_matches.map((m) => (
            <motion.div layout key={m.doc_code} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
              className="flex items-center gap-3 rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.02]">
              {m.cue === "pending" ? <Clock className="h-4 w-4 shrink-0 text-amber-500" /> : <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-500" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">{m.name}
                  {m.fuzzy && <Badge tone="violet" className="!py-0 text-[10px]">typo-tolerant</Badge>}
                </div>
                <div className="muted truncate text-xs">“{m.evidence}”</div>
              </div>
              <div className="text-right">
                <Badge tone={m.cue === "pending" ? "amber" : m.cue === "submitted" ? "emerald" : "slate"}>
                  {m.cue === "pending" ? "will follow" : m.cue === "submitted" ? "sent" : "mentioned"}
                </Badge>
                <div className="mt-1 text-[11px] tabular-nums text-stone-400">{(m.score * 100).toFixed(0)}% match</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {(analysis.entities.dates.length > 0 || analysis.entities.test_scores.length > 0 || analysis.entities.amounts.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {analysis.entities.dates.map((d, i) => <Badge key={`d${i}`} tone="sky" icon={<CalendarDays className="h-3 w-3" />}>{d.text}</Badge>)}
          {analysis.entities.test_scores.map((t, i) => <Badge key={`s${i}`} tone="violet">{t.test} {t.score}</Badge>)}
          {analysis.entities.amounts.map((a, i) => <Badge key={`a${i}`} tone="emerald">{a}</Badge>)}
        </div>
      )}
    </div>
  );
}
