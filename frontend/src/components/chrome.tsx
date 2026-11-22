import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Moon, Search, Sun, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useApi, useDebounced, useHotkey } from "../lib/hooks";
import { useTheme } from "../lib/theme";
import type { Enrolment, Notification } from "../lib/types";
import { StatusPill } from "./status";
import { Avatar, Kbd } from "./ui";
import { DemoLockTag, useDemoGate } from "./DemoGate";

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label="Toggle dark mode"
      className="rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.06] dark:hover:text-white">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? "d" : "l"} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} className="block">
          {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<{ items: Notification[]; unread: number }>("/api/notifications");
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(reload, 20000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  const markAll = async () => { await api.post("/api/notifications/read"); reload(); };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen((o) => !o); reload(); }} aria-label="Notifications"
        className="relative rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/[0.06] dark:hover:text-white">
        <Bell className="h-[18px] w-[18px]" />
        {!!data?.unread && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {data.unread > 9 ? "9+" : data.unread}
          </motion.span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-lift dark:border-white/10 dark:bg-[#231321]">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 dark:border-white/[0.06]">
              <span className="text-sm font-semibold">Notifications</span>
              {!!data?.unread && <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"><CheckCheck className="h-3.5 w-3.5" /> Mark all read</button>}
            </div>
            <div className="scrollbar-thin max-h-96 overflow-y-auto">
              {(data?.items ?? []).length === 0 && <p className="muted p-6 text-center text-sm">You're all caught up.</p>}
              {data?.items.map((n) => (
                <button key={n.id} onClick={() => { setOpen(false); if (n.link) nav(n.link); }}
                  className="flex w-full gap-3 px-4 py-3 text-left transition hover:bg-stone-50 dark:hover:bg-white/[0.03]">
                  <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-brand-500")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body && <span className="muted line-clamp-2 block text-xs">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-stone-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** ⌘K search across enrolments (admin). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 200);
  const nav = useNavigate();
  const { data } = useApi<{ items: Enrolment[] }>(open ? `/api/admin/enrolments?limit=8${dq ? `&q=${encodeURIComponent(dq)}` : ""}` : null, [dq]);
  useHotkey("k", useCallback(() => setOpen((o) => !o), []));
  useEffect(() => { if (!open) { setQ(""); setActive(0); } }, [open]);
  const items = data?.items ?? [];
  const go = (e: Enrolment) => { setOpen(false); nav(`/admin/enrolments/${e.id}`); };
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-400 shadow-sm transition hover:border-stone-300 dark:border-white/10 dark:bg-white/[0.03] md:flex">
        <Search className="h-4 w-4" /> Search enrolments… <span className="ml-auto"><Kbd>⌘K</Kbd></span>
      </button>
      <button onClick={() => setOpen(true)} className="rounded-xl p-2 text-stone-500 md:hidden" aria-label="Search"><Search className="h-[18px] w-[18px]" /></button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
            <motion.div initial={{ y: -10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -10, scale: 0.98 }}
              className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#231321]">
              <div className="flex items-center gap-3 border-b border-stone-100 px-4 dark:border-white/[0.06]">
                <Search className="h-5 w-5 text-stone-400" />
                <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder="Customer, email, ENR ref or programme…"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
                    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                    if (e.key === "Enter" && items[active]) go(items[active]);
                    if (e.key === "Escape") setOpen(false);
                  }}
                  className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-stone-400 focus-visible:ring-0 focus-visible:ring-offset-0" />
                <Kbd>esc</Kbd>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                {items.length === 0 && <p className="muted p-6 text-center text-sm">No matches.</p>}
                {items.map((e, i) => (
                  <button key={e.id} onMouseEnter={() => setActive(i)} onClick={() => go(e)}
                    className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === active && "bg-stone-100 dark:bg-white/[0.06]")}>
                    <Avatar name={e.customer_name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{e.customer_name}</div>
                      <div className="muted truncate text-xs">{e.enrolment_ref} · {e.programme_name}</div>
                    </div>
                    <StatusPill status={e.status} />
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function Dropzone({ onFiles, children, accept, disabled, compact }: {
  onFiles: (files: File[]) => void; children?: ReactNode; accept?: string; disabled?: boolean; compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const demo = useDemoGate();
  const pick = () => { if (!disabled && !demo.block("upload documents")) input.current?.click(); };
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    if (disabled || !e.dataTransfer.files.length || demo.block("upload documents")) return;
    onFiles([...e.dataTransfer.files]);
  };
  return (
    <div onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
      onClick={pick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }}
      className={clsx("group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition",
        compact ? "gap-1 px-4 py-4" : "gap-2 px-6 py-8",
        over ? "scale-[1.01] border-brand-500 bg-brand-50/70 dark:bg-brand-500/10" : "border-stone-200 hover:border-brand-400 hover:bg-stone-50 dark:border-white/10 dark:hover:bg-white/[0.02]",
        disabled && "pointer-events-none opacity-50", demo.isDemo && "opacity-70 saturate-50")}>
      <DemoLockTag />
      <input ref={input} type="file" hidden accept={accept} multiple={!compact}
        onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = ""; }} />
      {children ?? (
        <>
          <motion.div animate={over ? { y: -4 } : { y: 0 }} className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <Upload className="h-5 w-5" />
          </motion.div>
          <p className="text-sm font-medium">Drop files here or <span className="text-brand-600 dark:text-brand-300">browse</span></p>
          <p className="muted text-xs">PDF, JPG, PNG, TXT · up to 5 MB</p>
        </>
      )}
    </div>
  );
}
