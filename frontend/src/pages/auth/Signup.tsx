import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PasswordField, passwordProblems } from "../../components/PasswordField";
import { Button, Field, Skeleton } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import type { Programme, User } from "../../lib/types";
import { AuthShell } from "./AuthShell";
import { ProgrammeCard } from "./ProgrammePicker";

export default function Signup() {
  const { data, loading } = useApi<{ items: Programme[] }>("/api/programmes");
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [programmeId, setProgrammeId] = useState<number | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", phone: "", country: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErrors({});
    const missing = passwordProblems(form.password);
    if (missing.length) { setErrors({ password: `Your password needs ${missing.join(", ")}.` }); return; }
    setBusy(true);
    try {
      const r = await api.post<{ user: User; enrolment_id: number }>("/api/auth/signup", { ...form, phone: form.phone || null, programme_id: programmeId });
      setUser(r.user);
      toast.success("You're enrolled! Here's your document checklist.");
      nav(`/portal/enrolments/${r.enrolment_id}`);
    } catch (err) {
      const e2 = err as ApiError;
      setErrors(e2.fields);
      if (!Object.keys(e2.fields).length) toast.error(e2.message);
    } finally { setBusy(false); }
  };

  const chosen = data?.items.find((p) => p.id === programmeId);
  return (
    <AuthShell>
      <div className="mb-6 flex items-center gap-2 text-xs font-medium text-stone-500">
        {[1, 2].map((s) => <span key={s} className={`h-1.5 flex-1 rounded-full transition ${step >= s ? "bg-brand-600" : "bg-stone-200 dark:bg-white/10"}`} />)}
      </div>
      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-2xl font-semibold tracking-tight">Choose your programme</h2>
            <p className="muted mt-1 text-sm">You'll see exactly which documents you need before you sign up.</p>
            <div className="mt-6 space-y-3">
              {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}
              {data?.items.map((p) => <ProgrammeCard key={p.id} p={p} selected={p.id === programmeId} onSelect={() => setProgrammeId(p.id)} />)}
            </div>
            <Button size="lg" className="mt-6 w-full" disabled={!programmeId} onClick={() => setStep(2)}>Continue <ArrowRight className="h-4 w-4" /></Button>
          </motion.div>
        ) : (
          <motion.form key="s2" onSubmit={submit} noValidate initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <button type="button" onClick={() => setStep(1)} className="muted flex items-center gap-1 text-sm hover:text-stone-900 dark:hover:text-white"><ArrowLeft className="h-4 w-4" /> {chosen?.name}</button>
            <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
            <Field label="Full name" error={errors.full_name}><input className={`input ${errors.full_name ? "input-error" : ""}`} value={form.full_name} onChange={set("full_name")} autoComplete="name" /></Field>
            <Field label="Email" error={errors.email}><input className={`input ${errors.email ? "input-error" : ""}`} type="email" value={form.email} onChange={set("email")} autoComplete="email" /></Field>
            <PasswordField label="Choose a password" value={form.password} error={errors.password}
              onChange={(v) => { setForm({ ...form, password: v }); if (errors.password) setErrors({ ...errors, password: "" }); }} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone (optional)" error={errors.phone}><input className={`input ${errors.phone ? "input-error" : ""}`} value={form.phone} onChange={set("phone")} autoComplete="tel" /></Field>
              <Field label="Country (optional)" error={errors.country}><input className="input" value={form.country} onChange={set("country")} autoComplete="country-name" /></Field>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Create account & enrol</Button>
            <p className="muted text-center text-xs">Use synthetic details only – this is a prototype.</p>
          </motion.form>
        )}
      </AnimatePresence>
      <p className="muted mt-6 text-center text-sm">Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-300">Sign in</Link></p>
    </AuthShell>
  );
}
