import { MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, Field, Skeleton } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtDate } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import type { User } from "../../lib/types";
import { AuthShell } from "./AuthShell";

interface InvitePreview { email: string; customer_name: string; programme_name: string; enrolment_ref: string; expires_at: string }

export default function Invite() {
  const { code = "" } = useParams();
  const { data, error, loading } = useApi<{ invite: InvitePreview }>(`/api/auth/invite/${encodeURIComponent(code)}`);
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await api.post<{ user: User; enrolment_id: number }>(`/api/auth/invite/${encodeURIComponent(code)}/accept`, { password });
      setUser(r.user);
      toast.success("Welcome! Your checklist is ready.");
      nav(`/portal/enrolments/${r.enrolment_id}`);
    } catch (e2) { setErr((e2 as ApiError).fields.password ?? (e2 as ApiError).message); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      {loading && <Skeleton className="h-64" />}
      {error && (
        <div className="text-center">
          <h2 className="text-xl font-semibold">This invite can't be used</h2>
          <p className="muted mt-2 text-sm">{error.message}</p>
          <Link to="/login" className="mt-6 inline-block"><Button variant="secondary">Go to sign in</Button></Link>
        </div>
      )}
      {data && (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><MailCheck className="h-6 w-6" /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Hi {data.invite.customer_name.split(" ")[0]}, you're invited</h2>
            <p className="muted mt-1 text-sm">Set a password to open your onboarding checklist for <span className="font-medium text-stone-800 dark:text-stone-200">{data.invite.programme_name}</span>.</p>
          </div>
          <div className="rounded-xl bg-stone-100 px-3 py-2 text-sm dark:bg-white/[0.05]">{data.invite.email}<span className="muted float-right text-xs">expires {fmtDate(data.invite.expires_at)}</span></div>
          <Field label="Choose a password" error={err} hint="At least 8 characters with a letter and a number.">
            <input className={`input ${err ? "input-error" : ""}`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Open my checklist</Button>
        </form>
      )}
    </AuthShell>
  );
}
