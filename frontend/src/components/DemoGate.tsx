import { Eye, Lock, Sparkles, UserPlus } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, DEMO_BLOCKED_EVENT } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Modal } from "./ui";

/**
 * Shared demo learner logins can look around the portal but not change anything.
 * `block("upload documents")` returns true (and opens the "create your account" dialog)
 * when the signed-in user is a demo account. The server enforces the same rule.
 */
interface DemoGate { isDemo: boolean; block: (action: string) => boolean; handleError: (err: unknown) => boolean }

const DemoContext = createContext<DemoGate>({ isDemo: false, block: () => false, handleError: () => false });
export const useDemoGate = () => useContext(DemoContext);

export function DemoProvider({ children }: { children: ReactNode }) {
  const { user, logout, setUser } = useAuth();
  const nav = useNavigate();
  const isDemo = !!user?.is_demo;
  const [action, setAction] = useState<string | null>(null);

  const block = useCallback((what: string) => { if (!isDemo) return false; setAction(what); return true; }, [isDemo]);
  // Any request the server refuses as "demo_account" opens the pop-up (and turns on the banner,
  // in case this page loaded before the account was marked as a demo).
  useEffect(() => {
    const onBlocked = () => {
      setAction((a) => a ?? "make changes");
      if (user && !user.is_demo) setUser({ ...user, is_demo: true });
    };
    window.addEventListener(DEMO_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(DEMO_BLOCKED_EVENT, onBlocked);
  }, [user, setUser]);
  /** True when the error was a demo block (the pop-up is already open), so callers skip their own toast. */
  const handleError = useCallback((err: unknown) => err instanceof ApiError && err.code === "demo_account", []);
  const value = useMemo(() => ({ isDemo, block, handleError }), [isDemo, block, handleError]);

  const createAccount = async () => { setAction(null); await logout(); nav("/signup"); };

  return (
    <DemoContext.Provider value={value}>
      {children}
      <Modal open={!!action} onClose={() => setAction(null)} size="sm" title="Create your account to continue"
        description={`You're exploring a shared demo account, so you can't ${action} here.`}
        footer={<><Button variant="ghost" onClick={() => setAction(null)}>Keep exploring</Button>
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={createAccount}>Create my account</Button></>}>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />Your own account takes under a minute – pick a programme and your checklist is ready straight away.</li>
          <li className="flex gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />Upload documents, message the onboarding team and enrol on more programmes.</li>
          <li className="flex gap-2"><Eye className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />The demo stays read-only so every visitor sees the same synthetic data.</li>
        </ul>
      </Modal>
    </DemoContext.Provider>
  );
}

/**
 * Always-visible strip pinned above the portal header for demo logins, so it's clear on every
 * screen (and while scrolling) that this is a shared, read-only demo account.
 */
export function DemoStrip() {
  const { isDemo, block } = useDemoGate();
  useEffect(() => {
    if (!isDemo) return;
    const before = document.title;
    document.title = `Demo account · ${before}`;
    return () => { document.title = before; };
  }, [isDemo]);
  if (!isDemo) return null;
  return (
    <div role="status" className="relative overflow-hidden bg-gradient-to-r from-brand-600 via-accent-600 to-brand-600 bg-[length:200%_100%] animate-gradient-x text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-white/40">
          <Eye className="h-3.5 w-3.5" />Demo account
        </span>
        <span className="min-w-0 flex-1 text-white/95">
          <span className="font-semibold">Read-only preview with synthetic data.</span>
          <span className="hidden sm:inline"> Uploads, messages and enrolments are switched off.</span>
        </span>
        <button onClick={() => block("upload documents, send messages or enrol")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm transition hover:bg-brand-50">
          <UserPlus className="h-3.5 w-3.5" />Create your account
        </button>
      </div>
    </div>
  );
}

/** Small "Demo" tag shown next to the signed-in name. */
export function DemoTag() {
  const { isDemo } = useDemoGate();
  if (!isDemo) return null;
  return <span className="rounded-md bg-gradient-to-r from-brand-500 to-accent-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Demo</span>;
}

/** Corner tag on actions that are switched off for demo logins. */
export function DemoLockTag() {
  const { isDemo } = useDemoGate();
  if (!isDemo) return null;
  return (
    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-stone-900/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-white/15">
      <Lock className="h-3 w-3" />Demo
    </span>
  );
}
