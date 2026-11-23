import clsx from "clsx";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { Field } from "./ui";

/**
 * Password rules – the same ones the server enforces (backend/app/validation.py → clean_password).
 * Keep the two in sync.
 */
export const PASSWORD_RULES = [
  { key: "length", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { key: "letter", label: "At least one letter (a–z)", test: (p: string) => /[A-Za-z]/.test(p) },
  { key: "number", label: "At least one number (0–9)", test: (p: string) => /\d/.test(p) },
] as const;
export const PASSWORD_MAX = 128;

/** Plain-language list of what is still missing; empty when the password is acceptable. */
export function passwordProblems(p: string): string[] {
  const missing = PASSWORD_RULES.filter((r) => !r.test(p)).map((r) => r.label.toLowerCase());
  if (p.length > PASSWORD_MAX) missing.push(`no more than ${PASSWORD_MAX} characters`);
  return missing;
}

export const PASSWORD_RULES_TEXT = "At least 8 characters, with at least one letter and one number.";

/** Password input for choosing a NEW password: show/hide toggle plus a live checklist of the rules. */
export function PasswordField({ label = "Password", value, onChange, error, autoFocus }: {
  label?: string; value: string; onChange: (v: string) => void; error?: string; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  const rulesId = useId();
  const tooLong = value.length > PASSWORD_MAX;
  return (
    <Field label={label} error={error}>
      <div className="relative">
        <input className={clsx("input pr-10", error && "input-error")} type={show ? "text" : "password"} autoComplete="new-password"
          value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} aria-describedby={rulesId} />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
          aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <ul id={rulesId} className="mt-2 grid gap-1 text-[13px]" aria-label="Password rules">
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.key} className={clsx("flex items-center gap-1.5 transition-colors", ok ? "text-emerald-600 dark:text-emerald-400" : "text-stone-500 dark:text-stone-400")}>
              {ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
              {r.label}<span className="sr-only">{ok ? " – done" : " – not yet"}</span>
            </li>
          );
        })}
        {tooLong && <li className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400"><Circle className="h-3 w-3" />No more than {PASSWORD_MAX} characters</li>}
      </ul>
    </Field>
  );
}
