import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardCheck, FileSearch, GraduationCap, Inbox, LayoutDashboard, LogOut, Menu, MessageSquareText, ScrollText, Sparkles, Users, X } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CommandPalette, NotificationBell, ThemeToggle } from "../components/chrome";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { Avatar, Badge, PageSkeleton } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";

interface Stats { awaiting_verification: number; pending_drafts: number; unread_customer_messages: number }
interface LlmStatus { configured: boolean; provider_label: string; model: string; effort: string; prompt_version: string; demo_code_required: boolean }

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 text-white shadow-md shadow-accent-600/30">
        <ClipboardCheck className="h-[18px] w-[18px]" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Onboard<span className="text-gradient">ly</span></div>
        <div className="text-[11px] text-stone-500 dark:text-stone-400">Checklist Assistant</div>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobile, setMobile] = useState(false);
  const { data: stats, reload } = useApi<Stats>("/api/admin/dashboard");
  const { data: llm } = useApi<LlmStatus>("/api/admin/llm/status");
  useEffect(() => { setMobile(false); reload(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/enrolments", label: "Enrolments", icon: GraduationCap },
    { to: "/admin/verification", label: "Verification", icon: FileSearch, count: stats?.awaiting_verification },
    { to: "/admin/reviews", label: "Review queue", icon: Sparkles, count: stats?.pending_drafts },
    { to: "/admin/inbox", label: "Inbox", icon: Inbox, count: stats?.unread_customer_messages },
    { to: "/admin/customers", label: "Customers", icon: Users },
    { to: "/admin/programmes", label: "Programmes", icon: MessageSquareText },
    { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  ];

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-5"><Logo /></div>
      <nav className="flex-1 space-y-0.5 px-3">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}
            className={({ isActive }) => clsx("group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
              isActive ? "text-brand-700 dark:text-white" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.04] dark:hover:text-stone-100")}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand-100 to-accent-50 shadow-sm dark:from-brand-500/15 dark:to-accent-500/10" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <it.icon className="relative h-[18px] w-[18px]" />
                <span className="relative flex-1">{it.label}</span>
                {!!it.count && <span className="relative rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm">{it.count}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className={clsx("h-2 w-2 rounded-full", llm?.configured ? "animate-pulse-dot bg-emerald-500" : "bg-amber-500")} />
          {llm ? `${llm.provider_label} ${llm.configured ? "connected" : "not configured"}` : "AI provider"}
        </div>
        <div className="muted mt-1 text-[11px] leading-relaxed">
          {llm ? <>{llm.model} · effort {llm.effort} · prompts {llm.prompt_version}{!llm.configured && <><br />Template fallback in use</>}</> : "…"}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-stone-200 p-4 dark:border-white/[0.07]">
        <Avatar name={user?.full_name ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{user?.full_name.replace(/\s*\(.*\)/, "")}</div>
          <div className="muted truncate text-xs">Onboarding officer</div>
        </div>
        <button onClick={async () => { await logout(); nav("/login"); }} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10" aria-label="Sign out" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <AnimatedBackground />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-stone-200 bg-white/60 backdrop-blur-xl dark:border-white/[0.06] dark:bg-plum-950/60 lg:block">{sidebar}</aside>
      <AnimatePresence>
        {mobile && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-stone-900/40" onClick={() => setMobile(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-[#1d0f1b]">
              <button onClick={() => setMobile(false)} className="absolute right-3 top-5 rounded-lg p-1.5 text-stone-400" aria-label="Close menu"><X className="h-5 w-5" /></button>
              {sidebar}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-stone-200/70 bg-stone-50/80 px-4 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#160b14]/80 sm:px-6 lg:px-8">
        <button onClick={() => setMobile(true)} className="rounded-lg p-1.5 text-stone-500 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <CommandPalette />
        <div className="ml-auto flex items-center gap-1">
          {llm && !llm.configured && <Badge tone="amber" dot className="mr-2 hidden sm:inline-flex">AI fallback mode</Badge>}
          <ThemeToggle />
          <NotificationBell />
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Suspense fallback={<PageSkeleton />}>
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Outlet context={{ refreshStats: reload }} />
          </motion.div>
        </Suspense>
      </main>
    </div>
  );
}
