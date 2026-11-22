import clsx from "clsx";
import { motion } from "framer-motion";
import { Briefcase, Check, Cpu, Globe2, GraduationCap, Award } from "lucide-react";
import type { Programme } from "../../lib/types";

export const PROGRAMME_ICON: Record<string, typeof Cpu> = { Technology: Cpu, Business: Briefcase, International: Globe2, Certification: Award };
export const PROGRAMME_GRADIENT: Record<string, string> = {
  Technology: "from-sky-500 to-indigo-600", Business: "from-amber-500 to-rose-500",
  International: "from-emerald-500 to-teal-600", Certification: "from-violet-500 to-fuchsia-600",
};

export function ProgrammeCard({ p, selected, onSelect, disabled, note, noteTone = "emerald" }: { p: Programme; selected?: boolean; onSelect?: () => void; disabled?: boolean; note?: string; noteTone?: "emerald" | "rose" }) {
  const Icon = PROGRAMME_ICON[p.category] ?? GraduationCap;
  const mandatory = p.documents.filter((d) => d.is_mandatory);
  return (
    <motion.button type="button" whileHover={disabled ? {} : { y: -3 }} whileTap={disabled ? {} : { scale: 0.99 }} onClick={onSelect} disabled={disabled}
      className={clsx("group relative w-full overflow-hidden rounded-2xl border bg-white p-4 text-left transition dark:bg-white/[0.02]",
        selected ? "border-brand-500 shadow-glow" : "border-stone-200 hover:border-stone-300 hover:shadow-lift dark:border-white/10 dark:hover:border-white/20",
        disabled && "cursor-not-allowed opacity-60")}>
      <div className="flex items-start gap-3">
        <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", PROGRAMME_GRADIENT[p.category] ?? "from-brand-500 to-brand-700")}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{p.name}</div>
          <div className="muted text-xs">{p.category} · {p.duration_weeks} weeks</div>
        </div>
        <span className={clsx("flex h-6 w-6 items-center justify-center rounded-full border transition",
          selected ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 text-transparent dark:border-white/20")}>
          <Check className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="muted mt-3 line-clamp-2 text-[13px]">{p.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {mandatory.slice(0, 4).map((d) => (
          <span key={d.id} className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-white/[0.06] dark:text-stone-300">{d.name}</span>
        ))}
        {mandatory.length > 4 && <span className="rounded-md px-1.5 py-0.5 text-[11px] text-stone-500">+{mandatory.length - 4} more</span>}
      </div>
      {note && <div className={clsx("mt-3 text-xs font-medium", noteTone === "rose" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{note}</div>}
    </motion.button>
  );
}
