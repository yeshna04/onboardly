import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, BookCopy, Check, ChevronDown, FilePlus2, GraduationCap, Library, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Field, Modal, Segmented } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import type { Programme, RequiredDocument } from "../../lib/types";
import { PROGRAMME_GRADIENT, PROGRAMME_ICON } from "../auth/ProgrammePicker";

export type DocDraft = {
  key: string; doc_code: string; name: string; description: string; why_needed: string; keywords: string;
  accepted_formats: string; is_mandatory: boolean; validity_days: string; codeTouched: boolean; open: boolean;
};

const FORMATS = ["pdf", "jpg", "png", "txt", "csv", "json"];
const CATEGORIES = ["Technology", "Business", "International", "Certification"];

export const toCode = (name: string, max = 32) =>
  name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/^[^A-Z]+/, "").slice(0, max);

const programmeCode = (name: string) => {
  const words = name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]{2,}$/.test(w));
  return (words.length >= 2 ? words.map((w) => w[0]).join("") : name.replace(/[^A-Za-z]/g, "").slice(0, 4)).toUpperCase().slice(0, 6);
};

let seq = 0;
export const blankDoc = (from?: Partial<RequiredDocument>): DocDraft => ({
  key: `d${++seq}`, doc_code: from?.doc_code ?? "", name: from?.name ?? "", description: from?.description ?? "",
  why_needed: from?.why_needed ?? "", keywords: from?.keywords ?? "", accepted_formats: from?.accepted_formats ?? "pdf,jpg,png",
  is_mandatory: from ? !!from.is_mandatory : true, validity_days: from?.validity_days ? String(from.validity_days) : "",
  codeTouched: !!from, open: !from,
});

interface Props { open: boolean; onClose: () => void; onSaved: () => void; programme?: Programme | null; library: RequiredDocument[] }

/** Create a programme with its checklist (2 steps) or edit an existing programme's details. */
export function ProgrammeEditor({ open, onClose, onSaved, programme, library }: Props) {
  const editing = !!programme;
  const [step, setStep] = useState<0 | 1>(0);
  const [form, setForm] = useState({ name: "", code: "", category: "", duration_weeks: "8", description: "", keywords: "", is_active: true });
  const [codeTouched, setCodeTouched] = useState(false);
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0); setErrors({}); setShowLibrary(false);
    if (programme) {
      setForm({ name: programme.name, code: programme.code, category: programme.category, duration_weeks: String(programme.duration_weeks),
        description: programme.description, keywords: programme.keywords, is_active: !!programme.is_active });
      setCodeTouched(true); setDocs([]);
    } else {
      setForm({ name: "", code: "", category: "", duration_weeks: "8", description: "", keywords: "", is_active: true });
      setCodeTouched(false); setDocs([blankDoc()]);
    }
  }, [open, programme]);

  // Unique documents across all programmes, for one-click reuse.
  const libraryDocs = useMemo(() => {
    const seen = new Map<string, RequiredDocument>();
    library.forEach((d) => { if (!seen.has(d.doc_code)) seen.set(d.doc_code, d); });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [library]);
  const used = new Set(docs.map((d) => d.doc_code));

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === "name" && !codeTouched ? { code: programmeCode(v) } : {}) }));
  };
  const updateDoc = (key: string, patch: Partial<DocDraft>) => setDocs((ds) => ds.map((d) => {
    if (d.key !== key) return d;
    const next = { ...d, ...patch };
    if (patch.name !== undefined && !d.codeTouched) next.doc_code = toCode(patch.name);
    return next;
  }));
  const move = (i: number, dir: -1 | 1) => setDocs((ds) => {
    const j = i + dir; if (j < 0 || j >= ds.length) return ds;
    const copy = [...ds]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });

  const detailErrors = ["name", "code", "category", "duration_weeks", "description", "keywords"].some((k) => errors[k]);
  const docError = (i: number, f: string) => errors[`documents.${i}.${f}`];

  const goNext = () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 3) e.name = "Enter a programme name (3+ characters).";
    if (!form.code.trim()) e.code = "Enter a short code, e.g. UXD.";
    if (!form.category.trim()) e.category = "Choose or type a category.";
    if (form.description.trim().length < 10) e.description = "Describe the programme in at least 10 characters.";
    setErrors(e);
    if (!Object.keys(e).length) setStep(1);
  };

  const payload = () => ({
    name: form.name, code: form.code, category: form.category, duration_weeks: Number(form.duration_weeks) || undefined,
    description: form.description, keywords: form.keywords, is_active: form.is_active,
  });

  const save = async () => {
    setBusy(true); setErrors({});
    try {
      if (editing) {
        const { code: _code, ...rest } = payload();
        await api.patch(`/api/admin/programmes/${programme!.id}`, rest);
        toast.success("Programme updated");
      } else {
        const documents = docs.map((d) => ({
          doc_code: d.doc_code, name: d.name, description: d.description, why_needed: d.why_needed, keywords: d.keywords,
          accepted_formats: d.accepted_formats, is_mandatory: d.is_mandatory, validity_days: d.validity_days ? Number(d.validity_days) : null,
        }));
        await api.post("/api/admin/programmes", { ...payload(), documents });
        toast.success(`${form.name} created`, { description: `${documents.length} checklist document(s). It's now open for enrolment.` });
      }
      onSaved(); onClose();
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields);
      const f = err.fields;
      if (["name", "code", "category", "duration_weeks", "description", "keywords"].some((k) => f[k])) setStep(0);
      // open the rows that have errors
      setDocs((ds) => ds.map((d, i) => (Object.keys(f).some((k) => k.startsWith(`documents.${i}.`)) ? { ...d, open: true } : d)));
      toast.error(err.message);
    } finally { setBusy(false); }
  };

  const Icon = PROGRAMME_ICON[form.category] ?? GraduationCap;
  const mandatory = docs.filter((d) => d.is_mandatory).length;

  return (
    <Modal open={open} onClose={onClose} size="xl"
      title={editing ? `Edit ${programme!.name}` : "New programme"}
      description={editing ? "Update the programme details. Manage its documents from the programme card." : "Set up the programme, then build the document checklist customers will see."}
      footer={
        <>
          {!editing && step === 1 && <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {editing || step === 1
            ? <Button loading={busy} onClick={save} icon={<Check className="h-4 w-4" />}>{editing ? "Save changes" : "Create programme"}</Button>
            : <Button onClick={goNext}>Next: checklist</Button>}
        </>
      }>
      {!editing && (
        <div className="mb-6 flex items-center gap-3">
          {["Programme details", "Document checklist"].map((s, i) => (
            <button key={s} onClick={() => (i === 0 ? setStep(0) : goNext())} className="flex flex-1 items-center gap-2 text-left">
              <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
                i < step ? "bg-emerald-500 text-white" : i === step ? "bg-gradient-to-br from-brand-500 to-accent-500 text-white" : "bg-stone-100 text-stone-500 dark:bg-white/10",
                i === 0 && detailErrors && step === 1 && "ring-2 ring-rose-400")}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={clsx("text-sm", i === step ? "font-medium" : "muted")}>{s}</span>
              {i === 0 && <span className="h-px flex-1 bg-stone-200 dark:bg-white/10" />}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === 0 ? (
          <motion.div key="details" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="grid gap-5 lg:grid-cols-[1fr_260px]">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Programme name" error={errors.name} className="sm:col-span-2">
                <input className={clsx("input", errors.name && "input-error")} autoFocus value={form.name} onChange={set("name")} placeholder="e.g. UX Design Sprint" />
              </Field>
              <Field label="Code" error={errors.code} hint={editing ? "Codes can't change after creation." : "Short unique ID, auto-filled from the name."}>
                <input className={clsx("input font-mono uppercase", errors.code && "input-error")} value={form.code} disabled={editing}
                  onChange={(e) => { setCodeTouched(true); setForm({ ...form, code: e.target.value.toUpperCase() }); }} />
              </Field>
              <Field label="Duration (weeks)" error={errors.duration_weeks}>
                <input className={clsx("input", errors.duration_weeks && "input-error")} type="number" min={1} max={104} value={form.duration_weeks} onChange={set("duration_weeks")} />
              </Field>
              <Field label="Category" error={errors.category} className="sm:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, category: c })}
                      className={clsx("rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition",
                        form.category === c ? "bg-brand-500 text-white ring-brand-500" : "ring-stone-200 hover:ring-stone-300 dark:ring-white/10")}>{c}</button>
                  ))}
                  <input className={clsx("input w-40 py-1.5", errors.category && "input-error")} placeholder="Other…"
                    value={CATEGORIES.includes(form.category) ? "" : form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
              </Field>
              <Field label="Description" error={errors.description} className="sm:col-span-2" hint="Shown to customers on the programme card.">
                <textarea className={clsx("input min-h-[90px]", errors.description && "input-error")} value={form.description} onChange={set("description")} />
              </Field>
              <Field label="NLP keywords (comma-separated)" error={errors.keywords} className="sm:col-span-2"
                hint="Words customers use for this programme – the NLP uses them to detect which service a message is about.">
                <input className="input" value={form.keywords} onChange={set("keywords")} placeholder="ux, user experience, design, figma" />
              </Field>
              {editing && (
                <label className="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3 text-sm dark:bg-white/[0.03] sm:col-span-2">
                  <span><span className="font-medium">Open for enrolment</span><span className="muted block text-xs">Inactive programmes are hidden from customers; existing enrolments continue.</span></span>
                  <Segmented size="sm" value={form.is_active ? "on" : "off"} onChange={(v) => setForm({ ...form, is_active: v === "on" })}
                    options={[{ value: "on", label: "Active" }, { value: "off", label: "Inactive" }]} />
                </label>
              )}
            </div>
            {/* live card preview */}
            <div>
              <div className="muted mb-2 text-xs font-medium uppercase tracking-wide">Customer preview</div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", PROGRAMME_GRADIENT[form.category] ?? "from-brand-500 to-accent-600")}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0"><div className="truncate font-semibold">{form.name || "Programme name"}</div>
                    <div className="muted text-xs">{form.category || "Category"} · {form.duration_weeks || "?"} weeks</div></div>
                </div>
                <p className="muted mt-3 line-clamp-3 text-[13px]">{form.description || "A short description of the programme."}</p>
                {!editing && <div className="mt-3 flex flex-wrap gap-1">{docs.filter((d) => d.name).slice(0, 4).map((d) => <span key={d.key} className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] dark:bg-white/[0.06]">{d.name}</span>)}</div>}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="docs" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{mandatory} required</Badge><Badge>{docs.length - mandatory} optional</Badge>
              {errors.documents && <span className="text-sm text-rose-600">{errors.documents}</span>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" icon={<Library className="h-4 w-4" />} onClick={() => setShowLibrary((s) => !s)}>From library</Button>
                <Button size="sm" variant="soft" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setDocs((ds) => [...ds.map((d) => ({ ...d, open: false })), blankDoc()])}>Blank document</Button>
              </div>
            </div>

            <AnimatePresence>
              {showLibrary && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-3 dark:border-brand-500/30 dark:bg-brand-500/5">
                    <div className="muted mb-2 flex items-center gap-1.5 text-xs"><BookCopy className="h-3.5 w-3.5" />Documents already used by other programmes – click to copy (you can edit after adding).</div>
                    <div className="flex flex-wrap gap-1.5">
                      {libraryDocs.map((d) => (
                        <button key={d.doc_code} disabled={used.has(d.doc_code)}
                          onClick={() => setDocs((ds) => [...ds.filter((x) => x.name || x.doc_code), blankDoc(d)])}
                          className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-stone-200 transition hover:ring-brand-400 disabled:opacity-40 dark:bg-white/[0.05] dark:ring-white/10">
                          {used.has(d.doc_code) ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Plus className="h-3.5 w-3.5 text-brand-500" />}{d.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {docs.map((d, i) => {
                const rowHasError = Object.keys(errors).some((k) => k.startsWith(`documents.${i}.`));
                return (
                  <motion.div key={d.key} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, height: 0 }}
                    className={clsx("overflow-hidden rounded-2xl border bg-white dark:bg-white/[0.02]", rowHasError ? "border-rose-300 dark:border-rose-500/40" : "border-stone-200 dark:border-white/10")}>
                    <div className="flex items-center gap-2 px-4 py-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-500 dark:bg-white/10">{i + 1}</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => updateDoc(d.key, { open: !d.open })}>
                        <span className="block truncate text-sm font-medium">{d.name || <span className="muted">Untitled document</span>}</span>
                        <span className="muted font-mono text-[11px]">{d.doc_code || "CODE"}</span>
                      </button>
                      <button onClick={() => updateDoc(d.key, { is_mandatory: !d.is_mandatory })} title="Toggle required / optional">
                        <Badge tone={d.is_mandatory ? "brand" : "slate"}>{d.is_mandatory ? "required" : "optional"}</Badge>
                      </button>
                      <button className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-white/10" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                      <button className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-white/10" disabled={i === docs.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                      <button className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" onClick={() => setDocs((ds) => ds.filter((x) => x.key !== d.key))} aria-label="Remove document"><Trash2 className="h-4 w-4" /></button>
                      <button className="rounded-lg p-1.5 text-stone-400" onClick={() => updateDoc(d.key, { open: !d.open })} aria-label="Expand"><ChevronDown className={clsx("h-4 w-4 transition", d.open && "rotate-180")} /></button>
                    </div>
                    <AnimatePresence initial={false}>
                      {d.open && (
                        <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="grid gap-3 border-t border-stone-100 p-4 dark:border-white/[0.06] sm:grid-cols-2">
                            <Field label="Document name" error={docError(i, "name")}>
                              <input className={clsx("input", docError(i, "name") && "input-error")} value={d.name} placeholder="e.g. Design portfolio" autoFocus={!d.name}
                                onChange={(e) => updateDoc(d.key, { name: e.target.value })} />
                            </Field>
                            <Field label="Code" error={docError(i, "doc_code")}>
                              <input className={clsx("input font-mono uppercase", docError(i, "doc_code") && "input-error")} value={d.doc_code}
                                onChange={(e) => updateDoc(d.key, { doc_code: e.target.value.toUpperCase(), codeTouched: true })} />
                            </Field>
                            <Field label="What the customer should upload" error={docError(i, "description")} className="sm:col-span-2">
                              <input className={clsx("input", docError(i, "description") && "input-error")} value={d.description} placeholder="e.g. A PDF or link with 3 recent projects."
                                onChange={(e) => updateDoc(d.key, { description: e.target.value })} />
                            </Field>
                            <Field label="Why it's needed (optional)" className="sm:col-span-2">
                              <input className="input" value={d.why_needed} onChange={(e) => updateDoc(d.key, { why_needed: e.target.value })} />
                            </Field>
                            <Field label="NLP keywords" error={docError(i, "keywords")} className="sm:col-span-2" hint="Phrases customers use for this document, comma-separated.">
                              <input className="input" value={d.keywords} placeholder="portfolio, case study, behance" onChange={(e) => updateDoc(d.key, { keywords: e.target.value })} />
                            </Field>
                            <Field label="Accepted formats" error={docError(i, "accepted_formats")}>
                              <div className="flex flex-wrap gap-1.5">
                                {FORMATS.map((f) => {
                                  const on = d.accepted_formats.split(",").map((x) => x.trim()).includes(f);
                                  return (
                                    <button key={f} type="button" onClick={() => {
                                      const cur = d.accepted_formats.split(",").map((x) => x.trim()).filter(Boolean);
                                      updateDoc(d.key, { accepted_formats: (on ? cur.filter((x) => x !== f) : [...cur, f]).join(",") });
                                    }} className={clsx("rounded-lg px-2.5 py-1 font-mono text-xs uppercase ring-1 transition",
                                      on ? "bg-brand-500 text-white ring-brand-500" : "text-stone-500 ring-stone-200 dark:ring-white/10")}>{f}</button>
                                  );
                                })}
                              </div>
                            </Field>
                            <Field label="Valid for (days, optional)" error={docError(i, "validity_days")} hint="Older copies count as expired.">
                              <input className="input" type="number" min={1} value={d.validity_days} onChange={(e) => updateDoc(d.key, { validity_days: e.target.value })} />
                            </Field>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {docs.length === 0 && (
              <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm dark:border-white/10">
                No documents yet – add one from the library or start blank.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}
