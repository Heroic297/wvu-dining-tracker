/**
 * DateInput — a controlled MM / DD / YYYY input with no native date-picker chrome.
 * Props:
 *   value      — YYYY-MM-DD string (or "")
 *   onChange   — called with a YYYY-MM-DD string (or "" when incomplete)
 *   className  — extra classes applied to the outer wrapper
 *   testId     — data-testid prefix
 */
import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DateInputProps {
  value: string;          // YYYY-MM-DD or ""
  onChange: (val: string) => void;
  className?: string;
  testId?: string;
  disabled?: boolean;
}

/** Parse a YYYY-MM-DD string into { mm, dd, yyyy } display strings */
function parseParts(val: string): { mm: string; dd: string; yyyy: string } {
  if (!val) return { mm: "", dd: "", yyyy: "" };
  const [y, m, d] = val.split("-");
  return { mm: m ?? "", dd: d ?? "", yyyy: y ?? "" };
}

/** Combine display parts back to YYYY-MM-DD, or "" if incomplete */
function combine(mm: string, dd: string, yyyy: string): string {
  if (mm.length === 2 && dd.length === 2 && yyyy.length === 4) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

export function DateInput({ value, onChange, className, testId, disabled }: DateInputProps) {
  const { mm: initMm, dd: initDd, yyyy: initYyyy } = parseParts(value);
  const [mm, setMm]     = useState(initMm);
  const [dd, setDd]     = useState(initDd);
  const [yyyy, setYyyy] = useState(initYyyy);

  const mmRef   = useRef<HTMLInputElement>(null);
  const ddRef   = useRef<HTMLInputElement>(null);
  const yyyyRef = useRef<HTMLInputElement>(null);

  // Sync when parent value changes externally
  useEffect(() => {
    const { mm: m, dd: d, yyyy: y } = parseParts(value);
    setMm(m); setDd(d); setYyyy(y);
  }, [value]);

  // Fire onChange whenever any part changes
  function notify(newMm: string, newDd: string, newYyyy: string) {
    onChange(combine(newMm, newDd, newYyyy));
  }

  function handleMm(raw: string) {
    const v = raw.replace(/\D/g, "").slice(0, 2);
    setMm(v);
    notify(v, dd, yyyy);
    // Auto-advance when 2 digits entered and value is valid month
    if (v.length === 2) {
      const n = parseInt(v, 10);
      if (n >= 1 && n <= 12) ddRef.current?.focus();
    }
  }

  function handleDd(raw: string) {
    const v = raw.replace(/\D/g, "").slice(0, 2);
    setDd(v);
    notify(mm, v, yyyy);
    if (v.length === 2) {
      const n = parseInt(v, 10);
      if (n >= 1 && n <= 31) yyyyRef.current?.focus();
    }
  }

  function handleYyyy(raw: string) {
    const v = raw.replace(/\D/g, "").slice(0, 4);
    setYyyy(v);
    notify(mm, dd, v);
  }

  // Backspace from dd → focus mm; from yyyy → focus dd
  function handleDdKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && dd === "") mmRef.current?.focus();
  }
  function handleYyyyKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && yyyy === "") ddRef.current?.focus();
  }

  const segmentCls =
    "bg-transparent border-none outline-none text-center font-mono text-sm leading-none p-0 text-foreground placeholder-muted-foreground/50 focus:ring-0 focus:outline-none disabled:cursor-not-allowed";

  return (
    <div
      className={cn(
        "flex items-center gap-0 h-9 w-full rounded-md border border-input bg-background px-3 py-1",
        "focus-within:ring-1 focus-within:ring-ring",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      {/* MM */}
      <input
        ref={mmRef}
        type="text"
        inputMode="numeric"
        placeholder="MM"
        value={mm}
        onChange={(e) => handleMm(e.target.value)}
        disabled={disabled}
        data-testid={testId ? `${testId}-mm` : undefined}
        className={cn(segmentCls, "w-6")}
        maxLength={2}
        aria-label="Month"
      />
      <span className="text-muted-foreground/60 text-sm select-none">/</span>
      {/* DD */}
      <input
        ref={ddRef}
        type="text"
        inputMode="numeric"
        placeholder="DD"
        value={dd}
        onChange={(e) => handleDd(e.target.value)}
        onKeyDown={handleDdKey}
        disabled={disabled}
        data-testid={testId ? `${testId}-dd` : undefined}
        className={cn(segmentCls, "w-6")}
        maxLength={2}
        aria-label="Day"
      />
      <span className="text-muted-foreground/60 text-sm select-none">/</span>
      {/* YYYY */}
      <input
        ref={yyyyRef}
        type="text"
        inputMode="numeric"
        placeholder="YYYY"
        value={yyyy}
        onChange={(e) => handleYyyy(e.target.value)}
        onKeyDown={handleYyyyKey}
        disabled={disabled}
        data-testid={testId ? `${testId}-yyyy` : undefined}
        className={cn(segmentCls, "w-9")}
        maxLength={4}
        aria-label="Year"
      />
    </div>
  );
}
