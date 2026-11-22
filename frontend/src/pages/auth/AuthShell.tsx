import { motion } from "framer-motion";
import { Brain, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { AnimatedBackground } from "../../components/AnimatedBackground";
import { ThemeToggle } from "../../components/chrome";
import { Logo } from "../../layouts/AdminLayout";

const POINTS = [
  { icon: Brain, title: "Reads what customers send", text: "NLP detects the programme, documents and “I'll send it later” promises." },
  { icon: Sparkles, title: "Drafts reminders with AI", text: "Grounded in the real checklist – every claim is validated." },
  { icon: ShieldCheck, title: "A human approves everything", text: "Nothing reaches a customer without an officer's review." },
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <AnimatedBackground />
      <div className="relative hidden animate-gradient-x overflow-hidden bg-gradient-to-br from-[#2a0d1f] via-[#6b1838] to-[#b3401a] [background-size:200%_200%] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,.55),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(236,72,153,.35),transparent_45%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="[&_*]:!text-white"><Logo /></div>
          <div>
            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
              Onboarding checklists that <span className="bg-gradient-to-r from-amber-300 via-brand-300 to-accent-300 bg-clip-text text-transparent">keep themselves</span> up to date.
            </motion.h1>
            <div className="mt-10 space-y-5">
              {POINTS.map((p, i) => (
                <motion.div key={p.title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.1 }} className="flex max-w-md gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"><p.icon className="h-5 w-5" /></div>
                  <div><div className="font-medium">{p.title}</div><div className="text-sm text-white/65">{p.text}</div></div>
                </motion.div>
              ))}
            </div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
              className="mt-12 max-w-sm animate-float rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
              <div className="flex items-center justify-between text-sm"><span>Study-Abroad Pathway</span><span className="text-white/60">4 of 6</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                <motion.div className="h-full rounded-full bg-emerald-400" initial={{ width: 0 }} animate={{ width: "67%" }} transition={{ delay: 0.8, duration: 1 }} />
              </div>
              <div className="mt-3 space-y-1.5 text-[13px] text-white/80">
                {["Passport", "Academic transcript", "Fee receipt"].map((d) => <div key={d} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{d}</div>)}
              </div>
            </motion.div>
          </div>
          <p className="text-xs text-white/40">Prototype · synthetic data only · Project 040</p>
        </div>
      </div>
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-5 lg:justify-end"><div className="lg:hidden"><Logo /></div><ThemeToggle /></div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-6 shadow-lift sm:p-8">{children}</motion.div>
        </div>
      </div>
    </div>
  );
}
