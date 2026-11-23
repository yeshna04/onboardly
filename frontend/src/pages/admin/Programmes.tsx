import clsx from "clsx";
import { motion } from "framer-motion";
import { GraduationCap, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, ErrorState, Field, Modal, PageSkeleton, stagger } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import type { Programme, RequiredDocument } from "../../lib/types";
import { PROGRAMME_GRADIENT, PROGRAMME_ICON } from "../auth/ProgrammePicker";
import { ProgrammeEditor } from "./ProgrammeEditor";

type DocForm = { doc_code: string; name: string; description: string; why_needed: string; keywords: string; accepted_formats: string; is_mandatory: boolean };
const EMPTY: DocForm = { doc_code: "", name: "", description: "", why_needed: "", keywords: "", accepted_formats: "pdf,jpg,png", is_mandatory: true };

export default function Programmes() {
  const { data, error, loading, reload } = useApi<{ items: Programme[] }>("/api/admin/programmes");
  const [editing, setEditing] = useState<{ programme: Programme; doc: RequiredDocument | null } | null>(null);
  const [form, setForm] = useState<DocForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [programmeEditor, setProgrammeEditor] = useState<{ programme: Programme | null } | null>(null);

  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Error"} onRetry={reload} />;

  const open = (programme: Programme, doc: RequiredDocument | null) => {
    setEditing({ programme, doc }); setErrors({});
    setForm(doc ? { doc_code: doc.doc_code, name: doc.name, description: doc.description, why_needed: doc.why_needed, keywords: doc.keywords,
      accepted_formats: doc.accepted_formats, is_mandatory: !!doc.is_mandatory } : EMPTY);
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true); setErrors({});
    const body = { ...form };
    try {
      if (editing.doc) await api.patch(`/api/admin/documents/${editing.doc.id}`, body);
      else await api.post(`/api/admin/programmes/${editing.programme.id}/documents`, body);
      toast.success("Checklist template saved"); setEditing(null); reload();
    } catch (e) { setErrors((e as ApiError).fields); toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  const remove = async (doc: RequiredDocument) => {
    try { await api.del(`/api/admin/documents/${doc.id}`); toast.success("Removed"); reload(); } catch (e) { toast.error((e as ApiError).message); }
  };
  const set = (k: keyof DocForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="h-page">Programmes & checklists</h1><p className="muted mt-1 text-sm">Each programme's required documents. Keywords feed the NLP matcher.</p></div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setProgrammeEditor({ programme: null })}>New programme</Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {data.items.map((p, i) => {
          const Icon = PROGRAMME_ICON[p.category] ?? GraduationCap;
          return (
            <motion.div key={p.id} {...stagger(i)} className="card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-stone-100 p-5 dark:border-white/[0.06]">
                <div className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", PROGRAMME_GRADIENT[p.category] ?? "from-brand-500 to-accent-600")}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 font-semibold">{p.name}{!p.is_active && <Badge tone="amber">Inactive</Badge>}</div><div className="muted text-xs">{p.code} · {p.duration_weeks} weeks · {p.enrolment_count} enrolments</div></div>
                <Button size="sm" variant="ghost" icon={<Settings2 className="h-4 w-4" />} onClick={() => setProgrammeEditor({ programme: p })}>Edit</Button>
                <Button size="sm" variant="soft" icon={<Plus className="h-4 w-4" />} onClick={() => open(p, null)}>Document</Button>
              </div>
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.05]">
                {p.documents.map((d) => (
                  <li key={d.id} className="group flex items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{d.name}<span className="font-mono text-[11px] text-stone-400">{d.doc_code}</span>
                        {d.is_mandatory ? <Badge tone="brand" className="!py-0 text-[10px]">required</Badge> : <Badge className="!py-0 text-[10px]">optional</Badge>}
</div>
                      <div className="muted mt-0.5 line-clamp-1 text-xs">{d.keywords}</div>
                    </div>
                    <div className="flex opacity-0 transition group-hover:opacity-100">
                      <button className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10" onClick={() => open(p, d)} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                      <button className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" onClick={() => remove(d)} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>
      <ProgrammeEditor open={!!programmeEditor} programme={programmeEditor?.programme ?? null} onClose={() => setProgrammeEditor(null)} onSaved={reload}
        library={data.items.flatMap((x) => x.documents)} />
      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg" title={editing?.doc ? `Edit ${editing.doc.name}` : `Add document to ${editing?.programme.name}`}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" error={errors.doc_code}><input className="input font-mono uppercase" value={form.doc_code} onChange={set("doc_code")} disabled={!!editing?.doc} placeholder="VISA_LETTER" /></Field>
          <Field label="Name" error={errors.name}><input className="input" value={form.name} onChange={set("name")} /></Field>
          <Field label="Description (shown to customers)" error={errors.description} className="sm:col-span-2"><textarea className="input min-h-[70px]" value={form.description} onChange={set("description")} /></Field>
          <Field label="Why we need it" error={errors.why_needed} className="sm:col-span-2"><input className="input" value={form.why_needed} onChange={set("why_needed")} /></Field>
          <Field label="NLP keywords (comma-separated)" error={errors.keywords} className="sm:col-span-2" hint="Phrases customers use for this document, e.g. “visa letter, cas, offer letter”."><input className="input" value={form.keywords} onChange={set("keywords")} /></Field>
          <Field label="Accepted formats" error={errors.accepted_formats} className="sm:col-span-2"><input className="input" value={form.accepted_formats} onChange={set("accepted_formats")} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 rounded accent-brand-600" checked={form.is_mandatory} onChange={(e) => setForm({ ...form, is_mandatory: e.target.checked })} />Mandatory for completion</label>
        </div>
      </Modal>
    </div>
  );
}
