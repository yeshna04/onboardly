import clsx from "clsx";
import { motion } from "framer-motion";
import { Home, LogOut, MessageCircle, Plus } from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NotificationBell, ThemeToggle } from "../components/chrome";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { DemoProvider, DemoStrip, DemoTag } from "../components/DemoGate";
import { Avatar, PageSkeleton } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { Logo } from "./AdminLayout";

export function PortalLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { data } = useApi<{ unread_messages: number }>("/api/portal/overview", [loc.pathname]);
  const links = [
    { to: "/portal", label: "My onboarding", icon: Home, end: true },
    { to: "/portal/messages", label: "Messages", icon: MessageCircle, count: data?.unread_messages },
    { to: "/portal/programmes", label: "Programmes", icon: Plus },
  ];
  return (
    <DemoProvider>
    <div className="relative min-h-screen">
      <AnimatedBackground />
      <div className="sticky top-0 z-20">
      <DemoStrip />
      <header className="border-b border-stone-200/60 bg-white/70 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#160b14]/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) => clsx("relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                  isActive ? "text-brand-700 dark:text-white" : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white")}>
                {({ isActive }) => (<>
                  {isActive && <motion.span layoutId="portal-nav" className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand-100 to-accent-50 shadow-sm dark:from-brand-500/15 dark:to-accent-500/10" />}
                  <l.icon className="relative h-4 w-4" /><span className="relative">{l.label}</span>
                  {!!l.count && <span className="relative rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{l.count}</span>}
                </>)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <div className="ml-2 hidden items-center gap-2 sm:flex">
              <Avatar name={user?.full_name ?? "?"} className="h-8 w-8" />
              <span className="text-sm font-medium">{user?.full_name.split(" ")[0]}</span>
              <DemoTag />
            </div>
            <button onClick={async () => { await logout(); nav("/login"); }} className="ml-1 rounded-xl p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10" aria-label="Sign out" title="Sign out">
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>
      </div>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:pt-10">
        <Suspense fallback={<PageSkeleton />}>
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Outlet />
          </motion.div>
        </Suspense>
      </main>
      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-stone-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 dark:bg-[#1d0f1b]/90 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => clsx("relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", isActive ? "text-brand-600 dark:text-brand-300" : "text-stone-500")}>
            <l.icon className="h-5 w-5" />{l.label}
            {!!l.count && <span className="absolute right-[30%] top-1.5 h-2 w-2 rounded-full bg-rose-500" />}
          </NavLink>
        ))}
      </nav>
    </div>
    </DemoProvider>
  );
}
