import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { kgToLbs, todayStr } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Droplets,
  Target,
  Dumbbell,
  Waves,
  ChevronDown,
  ChevronUp,
  Zap,
  Apple,
  Ban,
  Flame,
  Beef,
  Wheat,
  Droplet,
  Trophy,
} from "lucide-react";

/** Round to 1 decimal place */
function r1(n: number) {
  return Math.round(n * 10) / 10;
}

// Phase colours (Tailwind classes)
const PHASE_STYLES: Record<
  string,
  { border: string; bg: string; badge: string; dot: string }
> = {
  "Normal prep": {
    border: "border-border",
    bg: "bg-secondary/40",
    badge: "bg-slate-500/20 text-slate-400",
    dot: "bg-slate-400",
  },
  "Gut cut": {
    border: "border-orange-500/40",
    bg: "bg-orange-500/5",
    badge: "bg-orange-500/20 text-orange-400",
    dot: "bg-orange-400",
  },
  Transition: {
    border: "border-yellow-500/40",
    bg: "bg-yellow-500/5",
    badge: "bg-yellow-500/20 text-yellow-400",
    dot: "bg-yellow-400",
  },
  Depletion: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    badge: "bg-amber-500/20 text-amber-400",
    dot: "bg-amber-400",
  },
  "Water load": {
    border: "border-blue-500/40",
    bg: "bg-blue-500/5",
    badge: "bg-blue-500/20 text-blue-400",
    dot: "bg-blue-400",
  },
  "Carb load": {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
    badge: "bg-emerald-500/20 text-emerald-400",
    dot: "bg-emerald-400",
  },
  "Final prep": {
    border: "border-purple-500/40",
    bg: "bg-purple-500/5",
    badge: "bg-purple-500/20 text-purple-400",
    dot: "bg-purple-400",
  },
  Competition: {
    border: "border-primary/50",
    bg: "bg-primary/5",
    badge: "bg-primary/20 text-primary",
    dot: "bg-primary",
  },
};

function phaseStyle(phase: string) {
  return PHASE_STYLES[phase] ?? PHASE_STYLES["Normal prep"];
}

interface PeakWeekDay {
  daysOut: number;
  label: string;
  phase: string;
  isToday: boolean;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg: number;
  waterL: string;
  focus: string;
  guidance: string[];
  foods: string[];
  avoid: string[];
  isKeyDay: boolean;
}

function PeakWeekDayCard({
  day,
  defaultOpen,
}: {
  day: PeakWeekDay;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const ps = phaseStyle(day.phase);

  return (
    <div
      data-testid={`peak-week-day-${day.daysOut}`}
      className={`rounded-xl border ${ps.border} ${day.isToday ? "ring-2 ring-primary" : ""} overflow-hidden`}
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full text-left flex items-center gap-3 p-3 ${ps.bg} transition-colors hover:brightness-110`}
      >
        {/* Phase dot */}
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ps.dot}`} />

        {/* Label + badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {day.label}
              {day.isToday && (
                <span className="ml-1.5 text-xs font-bold text-primary">
                  ← TODAY
                </span>
              )}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ps.badge}`}>
              {day.phase}
            </span>
            {day.isKeyDay && !day.isToday && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                Key day
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{day.focus}</p>
        </div>

        {/* Macro summary */}
        <div className="hidden sm:flex gap-3 text-xs text-right mr-2">
          <span className="text-primary font-semibold">{day.calories.toLocaleString()} kcal</span>
          <span className="text-green-400">{day.carbsG}g C</span>
          <span className="text-blue-400">
            <Droplets className="inline w-3 h-3" /> {day.waterL}
          </span>
        </div>

        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="p-4 border-t border-border space-y-4 bg-card">
          {/* Macro targets row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[
              { label: "Calories", value: `${day.calories.toLocaleString()} kcal`, color: "text-primary", Icon: Flame },
              { label: "Protein", value: `${day.proteinG}g`, color: "text-green-400", Icon: Beef },
              { label: "Carbs", value: `${day.carbsG}g`, color: "text-yellow-400", Icon: Wheat },
              { label: "Fat", value: `${day.fatG}g`, color: "text-orange-400", Icon: Droplet },
              { label: "Sodium", value: `${(day.sodiumMg / 1000).toFixed(1)}g`, color: "text-blue-400", Icon: Droplets },
            ].map(({ label, value, color, Icon }) => (
              <div key={label} className="bg-secondary/50 rounded-lg p-2">
                <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${color}`} />
                <p className={`text-sm font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Water */}
          <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Droplets className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span className="text-sm font-medium text-blue-300">
              Water target: {day.waterL}
            </span>
          </div>

          {/* Guidance bullets */}
          {day.guidance.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Guidance
                </h4>
              </div>
              <ul className="space-y-1.5">
                {day.guidance.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    <span className="text-foreground/90">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Foods + Avoid in 2 cols */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {day.foods.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Apple className="w-3.5 h-3.5 text-emerald-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Eat
                  </h4>
                </div>
                <ul className="space-y-1">
                  {day.foods.map((f, i) => (
                    <li
                      key={i}
                      className="text-xs text-foreground/80 flex items-center gap-1.5"
                    >
                      <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {day.avoid.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Avoid
                  </h4>
                </div>
                <ul className="space-y-1">
                  {day.avoid.map((a, i) => (
                    <li
                      key={i}
                      className="text-xs text-foreground/80 flex items-center gap-1.5"
                    >
                      <span className="w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DietPlanPage() {
  const { user } = useAuth();
  const today = todayStr();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/targets", today],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/targets?date=${today}`);
      if (!res.ok) throw new Error("Failed to get targets");
      return res.json();
    },
  });

  const { data: weightLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/weight"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/weight?limit=30");
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const targets = data?.targets;
  const waterCutPlan = data?.waterCutPlan;
  const peakWeekPlan: PeakWeekDay[] | null = data?.peakWeekPlan ?? null;
  const waterCutAnalysis = data?.waterCutAnalysis ?? null;
  const latestWeight = weightLogs[0]?.weightKg ?? user?.weightKg;

  if (!targets) {
    return (
      <div className="p-4 md:p-6 max-w-lg">
        <h1 className="text-xl font-bold mb-3">Diet plan</h1>
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <p className="text-muted-foreground text-sm">
            Complete your profile setup to see personalized targets.
          </p>
        </div>
      </div>
    );
  }

  const daysToTarget = user?.meetDate
    ? Math.max(
        0,
        Math.round(
          (new Date(user.meetDate).getTime() - Date.now()) / 86400000
        )
      )
    : user?.targetDate
    ? Math.max(
        0,
        Math.round(
          (new Date(user.targetDate).getTime() - Date.now()) / 86400000
        )
      )
    : null;

  const currentLbs = latestWeight ? r1(kgToLbs(latestWeight)) : null;
  const targetLbs = user?.targetWeightKg ? r1(kgToLbs(user.targetWeightKg)) : null;

  // Protocol breakdown — how much each component removes from scale weight
  // These match the buffer values in tdee.ts computeDailyTargets exactly
  const cutTier = waterCutAnalysis?.tier ?? 0;
  const useGutCut   = waterCutAnalysis?.useGutCut        ?? false;
  const useWaterCut = waterCutAnalysis?.useWaterSodiumLoad ?? false;
  const useDepletion = waterCutAnalysis?.useGlycogenDepletion ?? false;

  // Per-component estimates (conservative lower bounds)
  const gutCutPct        = useGutCut   ? 0.015 : 0;  // 1.5% BW (range: 1.5–2.5%)
  const waterCutPct      = useWaterCut ? 0.010 : 0;  // 1.0% BW
  const depletionPct     = useDepletion ? 0.015 : 0;  // 1.5% BW
  const totalBufferPct   = gutCutPct + waterCutPct + depletionPct;

  const gutCutLbs        = currentLbs ? r1(currentLbs * gutCutPct)    : 0;
  const waterCutLbs      = currentLbs ? r1(currentLbs * waterCutPct)  : 0;
  const depletionLbs     = currentLbs ? r1(currentLbs * depletionPct) : 0;
  const bufferLbs        = currentLbs ? r1(currentLbs * totalBufferPct) : 0;
  const hasBuffer        = totalBufferPct > 0 && bufferLbs > 0;
  const dietTargetLbs    = targetLbs !== null && hasBuffer ? r1(targetLbs + bufferLbs) : targetLbs;

  // How much the DIET needs to cover (current → diet target)
  const dietLbs = currentLbs !== null && dietTargetLbs !== null
    ? r1(Math.max(0, currentLbs - dietTargetLbs)) : 0;
  const lbsRemaining =
    currentLbs !== null && dietTargetLbs !== null
      ? r1(Math.abs(dietTargetLbs - currentLbs))
      : null;

  // Find today's peak week day
  const todayPeakDay = peakWeekPlan?.find((d) => d.isToday) ?? null;

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Diet plan</h1>
        {targets.isTrainingDay !== undefined && (
          <Badge variant={targets.isTrainingDay ? "default" : "secondary"}>
            {targets.isTrainingDay ? "Training day" : "Rest day"}
          </Badge>
        )}
      </div>

      {/* ── PEAK WEEK HERO (active day) ─────────────────────────────────── */}
      {peakWeekPlan && todayPeakDay && (
        <div
          data-testid="peak-week-hero"
          className={`rounded-2xl border-2 ${phaseStyle(todayPeakDay.phase).border} ${phaseStyle(todayPeakDay.phase).bg} p-5 space-y-4`}
        >
          {/* Phase label + today badge */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="w-5 h-5 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Peak Week · Today
                </span>
              </div>
              <h2 className="text-2xl font-bold">{todayPeakDay.phase}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{todayPeakDay.label}</p>
            </div>
            <div
              className={`text-xs px-3 py-1 rounded-full font-semibold ${phaseStyle(todayPeakDay.phase).badge}`}
            >
              {todayPeakDay.daysOut === 0 ? "🏆 Meet day" : `${todayPeakDay.daysOut} days out`}
            </div>
          </div>

          {/* Focus */}
          <div className="p-3 rounded-xl bg-background/50 border border-border">
            <p className="text-sm font-medium text-foreground">{todayPeakDay.focus}</p>
          </div>

          {/* Today's macro targets */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[
              { label: "Calories", value: `${todayPeakDay.calories.toLocaleString()}`, sub: "kcal", color: "text-primary" },
              { label: "Protein", value: `${todayPeakDay.proteinG}`, sub: "g", color: "text-green-400" },
              { label: "Carbs", value: `${todayPeakDay.carbsG}`, sub: "g", color: "text-yellow-400" },
              { label: "Fat", value: `${todayPeakDay.fatG}`, sub: "g", color: "text-orange-400" },
              { label: "Sodium", value: `${(todayPeakDay.sodiumMg / 1000).toFixed(1)}`, sub: "g Na", color: "text-blue-400" },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="rounded-xl bg-background/60 border border-border p-3">
                <p className={`text-lg font-bold ${color}`}>
                  {value}
                  <span className="text-xs font-normal ml-0.5">{sub}</span>
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Water */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <Droplets className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-blue-300">
                Water today: {todayPeakDay.waterL}
              </p>
              <p className="text-xs text-muted-foreground">
                Stay consistent throughout the day
              </p>
            </div>
          </div>

          {/* Top 3 guidance bullets */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" /> Today's focus
            </h3>
            {todayPeakDay.guidance.slice(0, 3).map((g, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                <span>{g}</span>
              </div>
            ))}
          </div>

          {/* Foods + avoid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1 mb-1.5">
                <Apple className="w-3.5 h-3.5" /> Eat
              </p>
              <ul className="space-y-0.5">
                {todayPeakDay.foods.slice(0, 5).map((f, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-red-400 flex items-center gap-1 mb-1.5">
                <Ban className="w-3.5 h-3.5" /> Avoid
              </p>
              <ul className="space-y-0.5">
                {todayPeakDay.avoid.slice(0, 5).map((a, i) => (
                  <li key={i} className="text-xs text-foreground/80 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── GOAL PROGRESS ──────────────────────────────────────────────────── */}
      {currentLbs !== null && targetLbs !== null && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Progress
          </h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold">{currentLbs}</p>
              <p className="text-xs text-muted-foreground">Current (lbs)</p>
            </div>
            <div className="flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-semibold text-primary">{lbsRemaining} lbs</p>
                <p className="text-xs text-muted-foreground">to go</p>
                {hasBuffer && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    +{bufferLbs} protocol
                  </p>
                )}
              </div>
            </div>
            <div>
              <p className="text-xl font-bold">{targetLbs}</p>
              <p className="text-xs text-muted-foreground">Target (lbs)</p>
            </div>
          </div>

          {hasBuffer && (
            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Weight loss breakdown</p>

              {/* Visual bar */}
              <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
                {dietLbs > 0 && (
                  <div
                    className="bg-primary h-full rounded-l-full"
                    style={{ width: `${(dietLbs / ((waterCutAnalysis?.cutKg ?? 0) * 2.20462 || 1)) * 100}%` }}
                    title={`Diet: ${dietLbs} lbs`}
                  />
                )}
                {gutCutLbs > 0 && (
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: `${(gutCutLbs / ((waterCutAnalysis?.cutKg ?? 0) * 2.20462 || 1)) * 100}%` }}
                    title={`Gut cut: ${gutCutLbs} lbs`}
                  />
                )}
                {waterCutLbs > 0 && (
                  <div
                    className="bg-blue-400 h-full"
                    style={{ width: `${(waterCutLbs / ((waterCutAnalysis?.cutKg ?? 0) * 2.20462 || 1)) * 100}%` }}
                    title={`Water cut: ${waterCutLbs} lbs`}
                  />
                )}
                {depletionLbs > 0 && (
                  <div
                    className="bg-purple-400 h-full rounded-r-full"
                    style={{ width: `${(depletionLbs / ((waterCutAnalysis?.cutKg ?? 0) * 2.20462 || 1)) * 100}%` }}
                    title={`Glycogen depletion: ${depletionLbs} lbs`}
                  />
                )}
              </div>

              {/* Legend rows */}
              <div className="space-y-1">
                {dietLbs > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-primary flex-shrink-0" />
                      <span className="text-muted-foreground">Diet (tissue weight)</span>
                    </span>
                    <span className="font-semibold">{dietLbs} lbs</span>
                  </div>
                )}
                {gutCutLbs > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-emerald-500 flex-shrink-0" />
                      <span className="text-muted-foreground">Gut cut <span className="text-foreground/50">(low-residue 3 days out, ~1.5–2.5% BW)</span></span>
                    </span>
                    <span className="font-semibold text-emerald-400">{gutCutLbs} lbs</span>
                  </div>
                )}
                {waterCutLbs > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-blue-400 flex-shrink-0" />
                      <span className="text-muted-foreground">Water/sodium cut <span className="text-foreground/50">(load days 4–3, cut day 2)</span></span>
                    </span>
                    <span className="font-semibold text-blue-400">{waterCutLbs} lbs</span>
                  </div>
                )}
                {depletionLbs > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-purple-400 flex-shrink-0" />
                      <span className="text-muted-foreground">Glycogen depletion <span className="text-foreground/50">(days 5–6)</span></span>
                    </span>
                    <span className="font-semibold text-purple-400">{depletionLbs} lbs</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground font-medium">Total to lose</span>
                  <span className="font-bold">{r1((waterCutAnalysis?.cutKg ?? 0) * 2.20462)} lbs</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Diet to <span className="font-semibold text-foreground">{dietTargetLbs} lbs</span> — the protocol handles the rest mechanically.
              </p>
            </div>
          )}

          {daysToTarget !== null && (
            <div className="mt-3 pt-3 border-t border-border flex justify-between text-sm">
              <span className="text-muted-foreground">Days remaining</span>
              <span className="font-semibold">{daysToTarget}</span>
            </div>
          )}
        </div>
      )}

      {/* Water cut analysis card */}
      {waterCutAnalysis && waterCutAnalysis.cutKg > 0 && (
        <div className={`rounded-xl border p-4 space-y-2 ${
          waterCutAnalysis.cutCategory === "unsafe" ? "border-destructive/60 bg-destructive/5"
          : waterCutAnalysis.cutCategory === "aggressive" ? "border-yellow-500/60 bg-yellow-500/5"
          : waterCutAnalysis.cutCategory === "moderate" ? "border-blue-500/40 bg-blue-500/5"
          : "border-border bg-card"
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Waves className="w-4 h-4 text-blue-400" />
              Weight class analysis
            </p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              waterCutAnalysis.cutCategory === "unsafe" ? "bg-destructive/20 text-destructive"
              : waterCutAnalysis.cutCategory === "aggressive" ? "bg-yellow-500/20 text-yellow-400"
              : waterCutAnalysis.cutCategory === "moderate" ? "bg-blue-500/20 text-blue-400"
              : "bg-emerald-500/20 text-emerald-400"
            }`}>
              {waterCutAnalysis.tier === 0 ? "At weight"
                : waterCutAnalysis.tier === 1 ? "Gut cut only"
                : waterCutAnalysis.tier === 2 ? "Water + gut cut"
                : waterCutAnalysis.tier === 3 ? "Full protocol"
                : waterCutAnalysis.tier === 4 ? "Aggressive"
                : "Unsafe"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-secondary rounded-lg p-2">
              <p className="text-sm font-bold">{kgToLbs(waterCutAnalysis.currentWeightKg).toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Current (lbs)</p>
            </div>
            <div className="bg-secondary rounded-lg p-2">
              <p className="text-sm font-bold text-blue-400">{kgToLbs(waterCutAnalysis.cutKg).toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">To cut (lbs)</p>
            </div>
            <div className="bg-secondary rounded-lg p-2">
              <p className="text-sm font-bold">{waterCutAnalysis.cutPct.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Of bodyweight</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{waterCutAnalysis.recommendation}</p>
          {waterCutAnalysis.useGlycogenDepletion && (
            <p className="text-xs text-blue-400">Glycogen depletion protocol active in your peak week plan.</p>
          )}
        </div>
      )}


      {/* ── DAILY TARGETS ──────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Target className="w-4 h-4" /> Daily targets
          </h2>
          {targets.isTrainingDay !== undefined && (
            <span className="text-xs text-muted-foreground">
              {targets.isTrainingDay ? "+150 kcal (training day)" : "−100 kcal (rest day)"}
            </span>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm">Calories</span>
            <span className="font-bold text-primary">
              {targets.calories.toLocaleString()} kcal
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-green-400">Protein</span>
            <span className="font-semibold text-green-400">{targets.proteinG}g</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-yellow-400">Carbohydrates</span>
            <span className="font-semibold text-yellow-400">{targets.carbsG}g</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-orange-400">Fat</span>
            <span className="font-semibold text-orange-400">{targets.fatG}g</span>
          </div>
          <div className="pt-2 border-t border-border space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>BMR</span>
              <span>{targets.bmr?.toLocaleString()} kcal</span>
            </div>
            <div className="flex justify-between">
              <span>TDEE</span>
              <span>{targets.tdee?.toLocaleString()} kcal</span>
            </div>
            <div className="flex justify-between">
              <span>
                Daily {targets.deficit < 0 ? "deficit" : "surplus"}
              </span>
              <span
                className={
                  targets.deficit < 0 ? "text-red-400" : "text-green-400"
                }
              >
                {Math.abs(targets.deficit)} kcal
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── PEAK WEEK FULL TIMELINE ─────────────────────────────────────────── */}
      {peakWeekPlan && peakWeekPlan.length > 0 && (
        <div className="space-y-3">
          {/* Phase legend */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" /> Peak Week Protocol
            </h2>
            <p className="text-xs text-muted-foreground">
              {peakWeekPlan.length} days
            </p>
          </div>

          {/* Phase colour legend */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Normal prep", color: "bg-slate-400" },
              { label: "Gut cut", color: "bg-orange-400" },
              { label: "Transition", color: "bg-yellow-400" },
              { label: "Depletion", color: "bg-amber-400" },
              { label: "Water load", color: "bg-blue-400" },
              { label: "Carb load", color: "bg-emerald-400" },
              { label: "Final prep", color: "bg-purple-400" },
              { label: "Competition", color: "bg-primary" },
            ].map(({ label, color }) => (
              <span
                key={label}
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span className={`w-2 h-2 rounded-full ${color}`} />
                {label}
              </span>
            ))}
          </div>

          {/* Day cards — today's card opens by default */}
          <div className="space-y-2">
            {peakWeekPlan.map((day) => (
              <PeakWeekDayCard
                key={day.daysOut}
                day={day}
                defaultOpen={day.isToday || day.isKeyDay}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground text-center pt-1">
            Educational guidance only — consult a sports dietitian before
            peak week.
          </p>
        </div>
      )}

      {/* ── WATER CUT PLAN (7-day) ──────────────────────────────────────────── */}
      {waterCutPlan && waterCutPlan.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">
            <Droplets className="w-4 h-4 text-blue-400" /> Water & Sodium Protocol
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            2-hr weigh-in protocol: 2 load days → sodium cut → 10–12h dry window. Educational guidance only.
          </p>
          <div className="space-y-2">
            {waterCutPlan.map((day: any) => (
              <div
                key={day.daysOut}
                data-testid={`watercut-day-${day.daysOut}`}
                className={`p-3 rounded-lg border ${day.daysOut === 1 ? "border-destructive/40 bg-destructive/5" : "border-border bg-secondary"}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">
                    {day.daysOut === 1 ? "Meet day −1" : `${day.daysOut} days out`}
                  </span>
                  <div className="flex gap-3 text-xs">
                    <span className="text-blue-400 flex items-center gap-1">
                      <Droplets className="w-3 h-3" />
                      {day.waterIntake}
                    </span>
                    <span className="text-amber-400 flex items-center gap-1">
                      <span className="font-mono text-[10px] font-bold">Na</span>
                      {day.sodiumLabel ?? `${day.sodiumMg?.toLocaleString() ?? "—"} mg`}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{day.notes}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── POWERLIFTING MEET INFO (shown when no peak week active yet) ──── */}
      {user?.meetDate && !peakWeekPlan && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Dumbbell className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Powerlifting meet</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Meet date:{" "}
            <span className="text-foreground font-medium">
              {new Date(user.meetDate + "T12:00:00").toLocaleDateString(
                "en-US",
                { month: "long", day: "numeric", year: "numeric" }
              )}
            </span>
          </p>
          {daysToTarget !== null && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {daysToTarget} days away — peak week protocol activates 14 days out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
