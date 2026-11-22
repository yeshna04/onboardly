import { ArrowRight, Briefcase, Eye, EyeOff, GraduationCap, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Field, Segmented } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { AuthShell } from "./AuthShell";

// Only the learner side has a public demo login. Staff accounts are never shared:
// they are created with backend/create_admin.py and their passwords never ship in the app.
const DEMO_LEARNER = { email: "aria.kestrel@learner.test", password: "LearnerDemo2026", who: "Aria · Study-Abroad learner" };

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<"customer" | "admin">("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  if (user) return <Navigate to={user.role === "admin" ? "/admin" : "/portal"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setFormError("");
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.full_name.split(" ")[0]}`);
      const next = params.get("next");
      nav(next && next.startsWith(u.role === "admin" ? "/admin" : "/portal") ? next : u.role === "admin" ? "/admin" : "/portal");
    } catch (err) {
      const e2 = err as ApiError;
      setErrors(e2.fields); setFormError(Object.keys(e2.fields).length ? "" : e2.message);
    } finally { setBusy(false); }
  };

  const fill = () => { setEmail(DEMO_LEARNER.email); setPassword(DEMO_LEARNER.password); setErrors({}); setFormError(""); };

  return (
    <AuthShell>
      <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
      <p className="muted mt-1 text-sm">Learners track their documents; officers run onboarding.</p>
      <div className="mt-6">
        <Segmented value={role} onChange={(v) => { setRole(v); setErrors({}); setFormError(""); }}
          options={[{ value: "customer", label: <><GraduationCap className="h-4 w-4" /> Learner</> }, { value: "admin", label: <><Briefcase className="h-4 w-4" /> Staff</> }]} />
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="Email" error={errors.email}>
          <input className={`input ${errors.email ? "input-error" : ""}`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={errors.password}>
          <div className="relative">
            <input className={`input pr-10 ${errors.password ? "input-error" : ""}`} type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        {formError && <p className="shake rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25">{formError}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in <ArrowRight className="h-4 w-4" /></Button>
      </form>

      {role === "customer" ? (
      <button onClick={fill} className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-3 text-left transition hover:bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/5 dark:hover:bg-brand-500/10">
        <span className="rounded-lg bg-brand-600 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Demo</span>
        <span className="text-sm"><span className="font-medium">Use demo account</span><span className="muted block text-xs">{DEMO_LEARNER.who} · read-only, synthetic data</span></span>
      </button>
      ) : (
        <p className="muted mt-5 flex items-center gap-2 rounded-2xl bg-stone-100/70 p-3 text-xs dark:bg-white/[0.04]">
          <ShieldCheck className="h-4 w-4 shrink-0 text-brand-500" />Staff accounts are issued by your administrator. There is no shared staff login.
        </p>
      )}

      {role === "customer" && (
        <p className="muted mt-6 text-center text-sm">New learner? <Link to="/signup" className="font-medium text-brand-600 hover:underline dark:text-brand-300">Enrol on a programme</Link></p>
      )}
    </AuthShell>
  );
}
