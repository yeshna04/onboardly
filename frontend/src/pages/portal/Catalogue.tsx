import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, ErrorState, Field, Modal, PageSkeleton } from "../../components/ui";
import { useDemoGate } from "../../components/DemoGate";
import { api, ApiError } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import type { Programme } from "../../lib/types";
import { ProgrammeCard } from "../auth/ProgrammePicker";

export default function Catalogue() {
  const { data, error, loading, reload } = useApi<{ items: Programme[] }>("/api/programmes");
  const { data: overview } = useApi<{ enrolments: { programme_name: string; status: string }[] }>("/api/portal/overview");
  const [chosen, setChosen] = useState<Programme | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const demo = useDemoGate();
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error?.message ?? "Error"} onRetry={reload} />;
  const statusOf = new Map(overview?.enrolments.map((e) => [e.programme_name, e.status]));

  const enrol = async () => {
    if (!chosen) return;
    if (demo.block("enrol on new programmes")) { setChosen(null); return; }
    setBusy(true);
    try {
      const r = await api.post<{ enrolment: { id: number } }>("/api/portal/enrolments", { programme_id: chosen.id, note: note || null });
      toast.success(`Enrolled on ${chosen.name}`); nav(`/portal/enrolments/${r.enrolment.id}`);
    } catch (e) { if (!demo.handleError(e)) toast.error((e as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-semibold tracking-tight">Programmes</h1><p className="muted mt-1">Add another programme – you'll see its document checklist straight away.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.items.map((p) => <ProgrammeCard key={p.id} p={p} disabled={statusOf.has(p.name)} note={!statusOf.has(p.name) ? undefined : statusOf.get(p.name) === "cancelled" ? "✕ Enrolment cancelled – message the team to rejoin" : "✓ You're enrolled"}
            noteTone={statusOf.get(p.name) === "cancelled" ? "rose" : "emerald"} onSelect={() => setChosen(p)} />)}
      </div>
      <Modal open={!!chosen} onClose={() => setChosen(null)} title={`Enrol on ${chosen?.name}`} description="You'll need these documents:"
        footer={<><Button variant="ghost" onClick={() => setChosen(null)}>Cancel</Button><Button loading={busy} onClick={enrol}>Enrol now</Button></>}>
        <ul className="mb-4 space-y-1.5 text-sm">{chosen?.documents.map((d) => <li key={d.id} className="flex justify-between"><span>{d.name}</span><span className="muted text-xs">{d.is_mandatory ? "required" : "optional"}</span></li>)}</ul>
        <Field label="Anything we should know? (optional)"><textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
