import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, Copy, Info, Search, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HighlightedText, NlpInsights } from "../../components/nlp";
import { Avatar, Button, Field, Modal, Segmented, Skeleton } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { STATUS_LABEL } from "../../lib/format";
import { useApi, useDebounced } from "../../lib/hooks";
import type { Enrolment, Invite, NlpAnalysis, Programme } from "../../lib/types";
import { ProgrammeCard } from "../auth/ProgrammePicker";

interface CustomerRow { id: number; full_name: string; email: string; customer_ref: string; country: string | null; enrolment_count: number }

/** Example intake email for the chosen programme, built from its own required documents. */
export function sampleIntake(programme: Programme | undefined): string {
  if (!programme) return "";
  const docs = [...programme.documents].sort((a, b) => b.is_mandatory - a.is_mandatory || a.sort_order - b.sort_order);
  const lower = (name: string) => (/^[A-Z]{2,}/.test(name) || /^English/.test(name) ? name : name[0].toLowerCase() + name.slice(1));
  const [first, second, later] = docs.map((d) => lower(d.name));
  const parts = [`Hi team, I'd like to join the ${programme.name}.`];
  if (first && second) parts.push(`I've attached my ${first} and my ${second}.`);
  else if (first) parts.push(`I've attached my ${first}.`);
  if (later) parts.push(`I will send my ${later} next week.`);
  parts.push("Thanks!");
  return parts.join(" ");
}

export function useNlpPreview(text: string, programmeId: number | null) {
  const debounced = useDebounced(text, 400);
  const [analysis, setAnalysis] = useState<NlpAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!debounced.trim()) { setAnalysis(null); return; }
    let alive = true;
    setLoading(true);
    api.post<NlpAnalysis>("/api/admin/nlp/analyze", { text: debounced, programme_id: programmeId })
      .then((r) => alive && setAnalysis(r)).catch(() => undefined).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [debounced, programmeId]);
  return { analysis: text.trim() ? analysis : null, loading };
}

export function NewEnrolmentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const { data: customers, loading: loadingCustomers } = useApi<{ items: CustomerRow[] }>(open ? `/api/admin/customers?limit=8${dq ? `&q=${encodeURIComponent(dq)}` : ""}` : null, [dq]);
  const { data: programmes } = useApi<{ items: Programme[] }>(open ? "/api/programmes" : null);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [newCustomer, setNewCustomer] = useState({ full_name: "", email: "", phone: "", country: "" });
  const [programmeId, setProgrammeId] = useState<number | null>(null);
  const [intake, setIntake] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ enrolment: Enrolment; invite: Invite | null; created: number } | null>(null);
  const { analysis, loading: analysing } = useNlpPreview(step === 2 ? intake : "", programmeId);
  // Programmes this customer is already on: they can't be picked again (one enrolment per programme).
  const { data: customerDetail } = useApi<{ customer: { enrolments: Enrolment[] } }>(
    open && mode === "existing" && customer ? `/api/admin/customers/${customer.id}` : null, [customer?.id, mode]);
  const existing = useMemo(() => new Map((mode === "existing" && customer ? customerDetail?.customer.enrolments ?? [] : [])
    .map((e) => [e.programme_id, e])), [customerDetail, customer, mode]);
  useEffect(() => { if (programmeId && existing.has(programmeId)) setProgrammeId(null); }, [existing, programmeId]);
  const programme = programmes?.items.find((p) => p.id === programmeId);
  const names = useMemo(() => Object.fromEntries((programme?.documents ?? []).map((d) => [d.doc_code, d.name])), [programme]);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => { setStep(0); setCustomer(null); setProgrammeId(null); setIntake(""); setDone(null); setErrors({}); setQ(""); setMode("existing");
        setNewCustomer({ full_name: "", email: "", phone: "", country: "" }); }, 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  const canNext = step === 0 ? (mode === "existing" ? !!customer : !!newCustomer.full_name && !!newCustomer.email) : step === 1 ? !!programmeId && !existing.has(programmeId) : true;

  const create = async () => {
    setBusy(true); setErrors({});
    try {
      const body = { programme_id: programmeId, due_date: due || null, send_invite: true,
        ...(mode === "existing" ? { customer_id: customer!.id } : { customer: { ...newCustomer, phone: newCustomer.phone || null } }) };
      const r = await api.post<{ enrolment: Enrolment; invite: Invite | null }>("/api/admin/enrolments", body);
      let created = 0;
      if (intake.trim()) {
        const res = await api.post<{ created: unknown[] }>(`/api/admin/enrolments/${r.enrolment.id}/intake`, { text: intake });
        created = res.created.length;
      }
      setDone({ ...r, created });
      onCreated?.();
      toast.success(`Enrolment ${r.enrolment.enrolment_ref} created`);
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields);
      if (err.fields.email || err.fields.full_name || err.fields.phone) setStep(0);
      else if (err.status === 409 && err.fields.programme_id) { setStep(1); setProgrammeId(null); }
      toast.error(err.message);
    } finally { setBusy(false); }
  };

  const inviteUrl = done?.invite ? `${window.location.origin}/invite/${done.invite.code}` : "";
  const steps = ["Customer", "Programme", "Customer message"];

  return (
    <Modal open={open} onClose={onClose} size="xl" title={done ? "Enrolment created" : "New enrolment"}
      description={done ? undefined : "Three quick steps. The checklist is built automatically from the programme."}
      footer={done ? (
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => { onClose(); nav(`/admin/enrolments/${done.enrolment.id}`); }}>Open workspace</Button>
        </>
      ) : (
        <>
          {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
          {step < 2 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button>
            : <Button loading={busy} onClick={create}>{intake.trim() ? "Create & apply message" : "Create enrolment"}</Button>}
        </>
      )}>
      {done ? (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15">
            <CheckCircle2 className="h-9 w-9" />
          </motion.div>
          <h3 className="mt-4 text-lg font-semibold">{done.enrolment.customer_name} · {done.enrolment.programme_name}</h3>
          <p className="muted mt-1 text-sm">{done.enrolment.enrolment_ref}{done.created ? ` · ${done.created} document(s) recorded from the message` : ""}</p>
          {done.invite ? (
            <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-stone-200 p-4 text-left dark:border-white/10">
              <div className="text-sm font-medium">Customer portal invite</div>
              <p className="muted text-xs">Share this link with the customer (sending email is not connected in this prototype).</p>
              <div className="mt-3 flex gap-2">
                <input readOnly value={inviteUrl} className="input font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success("Invite link copied"); }}>Copy</Button>
              </div>
            </div>
          ) : <p className="muted mt-6 text-sm">This customer already has a portal account and has been notified.</p>}
        </motion.div>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-2">
                <div className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
                  i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-600 text-white" : "bg-stone-100 text-stone-500 dark:bg-white/10")}>
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={clsx("hidden text-sm sm:block", i === step ? "font-medium" : "muted")}>{s}</span>
                {i < steps.length - 1 && <div className="h-px flex-1 bg-stone-200 dark:bg-white/10" />}
              </div>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
              {step === 0 && (
                <div className="space-y-4">
                  <Segmented value={mode} onChange={setMode} options={[{ value: "existing", label: <><Search className="h-4 w-4" />Existing customer</> }, { value: "new", label: <><UserPlus className="h-4 w-4" />New customer</> }]} />
                  {mode === "existing" ? (
                    <>
                      <input autoFocus className="input" placeholder="Search by name, email or CUS ref…" value={q} onChange={(e) => setQ(e.target.value)} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        {loadingCustomers && !customers && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
                        {customers?.items.map((c) => (
                          <button key={c.id} onClick={() => setCustomer(c)}
                            className={clsx("flex items-center gap-3 rounded-xl border p-3 text-left transition",
                              customer?.id === c.id ? "border-brand-500 bg-brand-50/50 shadow-glow dark:bg-brand-500/10" : "border-stone-200 hover:border-stone-300 dark:border-white/10")}>
                            <Avatar name={c.full_name} />
                            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.full_name}</div><div className="muted truncate text-xs">{c.email}</div></div>
                            <span className="text-[11px] text-stone-400">{c.enrolment_count} enr.</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Full name" error={errors.full_name}><input className={clsx("input", errors.full_name && "input-error")} value={newCustomer.full_name} onChange={(e) => setNewCustomer({ ...newCustomer, full_name: e.target.value })} /></Field>
                      <Field label="Email" error={errors.email}><input className={clsx("input", errors.email && "input-error")} type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></Field>
                      <Field label="Phone (optional)" error={errors.phone}><input className={clsx("input", errors.phone && "input-error")} value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} /></Field>
                      <Field label="Country (optional)" error={errors.country}><input className="input" value={newCustomer.country} onChange={(e) => setNewCustomer({ ...newCustomer, country: e.target.value })} /></Field>
                    </div>
                  )}
                </div>
              )}
              {step === 1 && (
                <div>
                  {existing.size > 0 && (
                    <div className="mb-3 flex items-start gap-2 rounded-xl bg-stone-100/80 px-3 py-2.5 text-sm dark:bg-white/[0.04]">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                      <span><b>{customer?.full_name}</b> is already on {existing.size} programme{existing.size > 1 ? "s" : ""}. Those are greyed out – open the existing enrolment instead.</span>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {programmes?.items.map((p) => {
                      const ex = existing.get(p.id);
                      return (
                        <div key={p.id} className="relative">
                          <ProgrammeCard p={p} selected={p.id === programmeId} disabled={!!ex} onSelect={() => setProgrammeId(p.id)}
                            note={ex ? `Already enrolled · ${ex.enrolment_ref} · ${STATUS_LABEL[ex.status]}` : undefined} noteTone="rose" />
                          {ex && <button type="button" onClick={() => { onClose(); nav(`/admin/enrolments/${ex.id}`); }}
                            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-stone-200 hover:bg-white dark:bg-plum-800 dark:text-brand-200 dark:ring-white/10">
                            Open enrolment <ArrowRight className="h-3.5 w-3.5" /></button>}
                        </div>
                      );
                    })}
                  </div>
                  <Field label="Documents due by" className="mt-4 max-w-xs" error={errors.due_date}><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
                </div>
              )}
              {step === 2 && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="label">Paste the customer's email or notes <span className="muted font-normal">(optional)</span></label>
                      <button className="mb-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => setIntake(sampleIntake(programme))} disabled={!programme}
                        title={programme ? `Example email for ${programme.name}` : "Choose a programme first"}>Use sample</button>
                    </div>
                    <textarea className="input min-h-[150px] resize-y leading-6" value={intake} onChange={(e) => setIntake(e.target.value)}
                      placeholder={programme ? `e.g. “${sampleIntake(programme)}”` : "Paste what the customer wrote…"} />
                    {analysis && intake.trim() && (
                      <div className="mt-3 rounded-xl bg-stone-50 p-3 dark:bg-white/[0.03]">
                        <div className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">What the NLP sees</div>
                        <HighlightedText text={intake} highlights={analysis.highlights} names={names} />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label">Live extraction · {programme?.name}</label>
                    <NlpInsights analysis={analysis} loading={analysing} programmeCode={programme?.code} />
                    <p className="muted mt-3 text-xs">On create, “sent” documents are recorded as submitted (staff still verify them) and “will follow” ones as promised.</p>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </Modal>
  );
}
