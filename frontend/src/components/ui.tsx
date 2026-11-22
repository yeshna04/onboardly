import clsx from "clsx";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/* ---------------------------------------------------------------- Button */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "soft";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-brand-500 to-accent-500 text-white shadow-md shadow-accent-500/25 hover:shadow-glow-lg hover:brightness-110 disabled:from-brand-300 disabled:to-accent-300",
  secondary: "bg-white text-stone-800 border border-stone-200 hover:bg-stone-50 shadow-sm dark:bg-white/[0.04] dark:text-stone-100 dark:border-white/10 dark:hover:bg-white/[0.08]",
  ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-white/[0.06] dark:hover:text-white",
  danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
  success: "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/25 hover:brightness-110",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20",
};
const SIZES = { sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg", md: "h-10 px-4 text-sm gap-2 rounded-xl", lg: "h-12 px-5 text-[15px] gap-2 rounded-xl" };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: keyof typeof SIZES; loading?: boolean; icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={clsx("group relative inline-flex select-none items-center justify-center overflow-hidden whitespace-nowrap font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant], SIZES[size], className)} {...rest}>
      {(variant === "primary" || variant === "success") && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/35 to-transparent group-hover:animate-sheen" />
      )}
      {loading ? <Loader2 className="relative h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* ---------------------------------------------------------------- Badge */
export type Tone = "slate" | "brand" | "emerald" | "amber" | "rose" | "sky" | "violet";
const TONES: Record<Tone, string> = {
  slate: "bg-stone-100 text-stone-700 ring-stone-200 dark:bg-white/[0.06] dark:text-stone-300 dark:ring-white/10",
  brand: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/25",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25",
  rose: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25",
  sky: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/25",
};
export const DOT: Record<Tone, string> = {
  slate: "bg-stone-400", brand: "bg-brand-500", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", sky: "bg-sky-500", violet: "bg-violet-500",
};
export function Badge({ tone = "slate", children, dot, className, icon }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string; icon?: ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>
      {dot && <span className={clsx("h-1.5 w-1.5 rounded-full", DOT[tone])} />}
      {icon}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Progress */
export function ProgressRing({ value, size = 64, stroke = 7, label, tone }: { value: number; size?: number; stroke?: number; label?: ReactNode; tone?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone ?? (value >= 100 ? "#10b981" : value >= 50 ? "#f97316" : value > 0 ? "#f59e0b" : "#a8a29e");
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs><linearGradient id="ring-sunset" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fb923c" /><stop offset="1" stopColor="#ec4899" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-stone-100 dark:stroke-white/[0.07]" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" stroke={tone ?? (value >= 100 ? color : value > 0 ? "url(#ring-sunset)" : color)} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (Math.min(100, value) / 100) * c }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-center">
        {label ?? <span className="text-sm font-semibold tabular-nums">{Math.round(value)}%</span>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, className, tone }: { value: number; className?: string; tone?: string }) {
  const color = tone ?? (value >= 100 ? "bg-emerald-500" : value >= 50 ? "bg-brand-500" : value > 0 ? "bg-amber-500" : "bg-stone-300");
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-white/[0.07]", className)}>
      <motion.div className={clsx("h-full rounded-full", color)} initial={{ width: 0 }} animate={{ width: `${Math.min(100, value)}%` }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}

export function AnimatedNumber({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${v.toFixed(decimals)}${suffix}`);
  useEffect(() => { const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] }); return c.stop; }, [value, mv]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

/* ---------------------------------------------------------------- Skeleton / Spinner / Empty */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden rounded-lg bg-stone-200/70 dark:bg-white/[0.06]", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/[0.06]" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-4 w-4 animate-spin", className)} />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-500 dark:bg-white/[0.06] dark:text-stone-400">{icon}</div>}
      <h3 className="font-semibold">{title}</h3>
      {children && <p className="muted mt-1 max-w-sm text-sm">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad flex flex-col items-center gap-3 text-center">
      <p className="font-medium text-rose-600 dark:text-rose-400">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* ---------------------------------------------------------------- Modal & Drawer */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true"
            className={clsx("relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-[#231321] sm:rounded-3xl", width)}
            initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}>
            <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-6 py-5 dark:border-white/[0.06]">
              <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                {description && <p className="muted mt-0.5 text-sm">{description}</p>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 bg-stone-50/60 px-6 py-4 dark:border-white/[0.06] dark:bg-white/[0.02]">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------- Segmented / Tabs */
export function Segmented<T extends string>({ value, onChange, options, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md";
}) {
  const id = useState(() => Math.random().toString(36).slice(2))[0];
  return (
    <div className="inline-flex rounded-xl bg-stone-100 p-1 dark:bg-white/[0.05]">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={clsx("relative rounded-lg font-medium transition", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            value === o.value ? "text-stone-900 dark:text-white" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200")}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-white/[0.1]" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
          <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-white/[0.07]">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={clsx("relative whitespace-nowrap px-3.5 pb-3 pt-1 text-sm font-medium transition",
            value === t.value ? "text-brand-700 dark:text-brand-300" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200")}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-white/10 dark:text-stone-300">{t.count}</span>}
          {value === t.value && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Form field */
export function Field({ label, error, hint, children, className }: { label?: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <div className={clsx(error && "shake")} key={error}>{children}</div>
      <AnimatePresence>
        {error ? (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-[13px] text-rose-600 dark:text-rose-400">{error}</motion.p>
        ) : hint ? <p className="muted mt-1.5 text-[13px]">{hint}</p> : null}
      </AnimatePresence>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-stone-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-stone-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-stone-400">{children}</kbd>;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={clsx("flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", className ?? "h-8 w-8")}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 65% 58%), hsl(${(hue + 40) % 360} 60% 48%))` }}>
      {name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
    </div>
  );
}

export const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
};

export function stagger(i: number) {
  return { ...fadeUp, transition: { ...fadeUp.transition, delay: Math.min(i * 0.04, 0.4) } };
}
