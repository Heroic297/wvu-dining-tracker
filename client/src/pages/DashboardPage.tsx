import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { fmt1, todayStr, formatDate, kgToLbs, api } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PlusCircle, Flame, TrendingUp, UtensilsCrossed, Trophy, Droplets, Plus, Minus, ChevronDown, Pill, Dumbbell, Check } from "lucide-react";
import ProgressRing from "@/components/ProgressRing";

// Hex fallbacks for macro colours
const HEX = {
  protein:  "#34d399",
  carbs:    "#f59e0b",
  fat:      "#fb923c",
  calories: "#34d399",
};

// ── Page ────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const today = todayStr();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard");
      return res.json();
    },
    staleTime: 30000,
  });

  const { data: weightData } = useQuery<any[]>({
    queryKey: ["/api/weight"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/weight?limit=14");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Derived data — use nullish coalescing so these are safe before data loads
  const totals  = data?.totals  ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const targets = data?.targets;
  const meals   = data?.meals   ?? [];
  const recentActivity = data?.activities ?? [];
  const peakWeekToday   = data?.peakWeekToday ?? null;
  const waterMl         = data?.waterMl ?? 0;
  const waterTargetMl   = data?.waterTargetMl ?? null;
  const enableWaterTracking = data?.enableWaterTracking ?? false;
  const waterBottles    = (data?.waterBottles ?? []) as Array<{id: string; name: string; mlSize: number}>;
  const waterUnit       = (data?.waterUnit ?? "oz") as "ml" | "oz" | "L" | "gal";
  const trainingToday   = data?.trainingToday as {
    programName: string;
    weekNumber: number;
    dayLabel: string;
    exerciseCount: number;
    alreadyLogged: boolean;
  } | null | undefined;

  // Unit conversion helpers
  const ML_TO: Record<string, number> = { ml: 1, oz: 1/29.5735, L: 1/1000, gal: 1/3785.41 };
  const UNIT_LABEL: Record<string, string> = { ml: "ml", oz: "oz", L: "L", gal: "gal" };
  const toUnit = (ml: number) => +(ml * ML_TO[waterUnit]).toFixed(waterUnit === "ml" ? 0 : 2);
  const fromUnit = (val: number) => Math.round(val / ML_TO[waterUnit]);
  const fmtWater = (ml: number) => `${toUnit(ml)} ${UNIT_LABEL[waterUnit]}`;

  // ALL hooks must be declared before any early returns
  const waterMutation = useMutation({
    mutationFn: async (delta: number) => {
      const newVal = Math.max(0, waterMl + delta);
      const res = await api.logWater(today, newVal);
      return res.json();
    },
    onMutate: async (delta: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/dashboard"] });
      const prev = queryClient.getQueryData(["/api/dashboard"]);
      queryClient.setQueryData(["/api/dashboard"], (old: any) => ({
        ...old,
        waterMl: Math.max(0, (old?.waterMl ?? 0) + delta),
      }));
      return { prev };
    },
    onError: (_err: any, _delta: any, context: any) => {
      if (context?.prev) queryClient.setQueryData(["/api/dashboard"], context.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen text-slate-100 pb-24">
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
          <Skeleton className="h-7 w-36 rounded-lg bg-slate-800/60" />
          <div className="flex justify-center">
            <Skeleton className="h-[200px] w-[200px] rounded-full bg-slate-800/60" />
          </div>
          <div className="flex gap-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="flex-1 h-28 rounded-2xl bg-slate-800/60" />)}
          </div>
          <Skeleton className="h-36 rounded-2xl bg-slate-800/60" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="surface-card p-6 text-center space-y-3 max-w-xs">
          <p className="text-slate-300 text-sm">Couldn't load your dashboard. Check your connection and try again.</p>
          <Button variant="outline" onClick={() => refetch()} size="sm" className="border-white/10 bg-slate-900/60">Retry</Button>
        </div>
      </div>
    );
  }

  const weightChartData = (weightData ?? [])
    .slice(0, 7)
    .reverse()
    .map((w: any) => ({
      date: w.date.slice(5),
      lbs:  +kgToLbs(w.weightKg).toFixed(1),
    }));

  const caloriesConsumed = Math.round(totals.calories);
  const calorieGoal = targets?.calories ?? 2000;
  const calRemain = Math.round(calorieGoal - totals.calories);

  const protein = Math.round(totals.protein);
  const proteinGoal = targets?.proteinG ?? 160;
  const carbs = Math.round(totals.carbs);
  const carbsGoal = targets?.carbsG ?? 250;
  const fat = Math.round(totals.fat);
  const fatGoal = targets?.fatG ?? 70;

  // Weight trend
  const latestWeight = weightChartData.length > 0 ? weightChartData[weightChartData.length - 1]?.lbs : null;
  const prevWeight = weightChartData.length > 1 ? weightChartData[weightChartData.length - 2]?.lbs : null;
  const weightDelta = latestWeight !== null && prevWeight !== null ? +(latestWeight - prevWeight).toFixed(1) : null;

  // Water glasses (8oz = ~237ml per glass)
  const GLASS_ML = 237;
  const waterGlasses = Math.round(waterMl / GLASS_ML * 10) / 10;
  const waterTargetGlasses = waterTargetMl ? Math.round(waterTargetMl / GLASS_ML * 10) / 10 : 8;
  const waterPct = waterTargetMl ? Math.min(100, (waterMl / waterTargetMl) * 100) : Math.min(100, (waterGlasses / waterTargetGlasses) * 100);

  // Sparkline helper for weight
  const renderSparkline = () => {
    if (weightChartData.length < 2) return null;
    const vals = weightChartData.map((d: any) => d.lbs as number);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const w = 60, h = 24;
    const points = vals.map((v: number, i: number) =>
      `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`
    ).join(" ");
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-2">
        <polyline
          points={points}
          fill="none"
          stroke="#34d399"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div className="min-h-screen text-slate-100 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6 fade-up">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-3xl font-extrabold leading-tight gradient-text"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Today
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">{formatDate(today)}</p>
          </div>
          <Link href="/log">
            <Button
              size="sm"
              className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white border-0 shadow-[0_0_16px_hsl(158_64%_42%/0.35)]"
              data-testid="button-log-meal"
            >
              <PlusCircle className="w-4 h-4 mr-1.5" />
              Log meal
            </Button>
          </Link>
        </div>

        {/* Peak week card */}
        {peakWeekToday && (
          <div className={`surface-card p-4 space-y-3 ${
            peakWeekToday.isKeyDay ? "surface-card-accent" : ""
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Peak Week · Today</span>
              </div>
              <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full">
                {peakWeekToday.daysOut === 0 ? "Meet day" : `${peakWeekToday.daysOut} days out`}
              </span>
            </div>

            <div>
              <p className="text-lg font-bold leading-tight text-slate-100">{peakWeekToday.phase}</p>
              <p className="text-xs text-slate-500 mt-0.5">{peakWeekToday.label}</p>
            </div>

            <div className="bg-slate-800/60 rounded-xl px-3 py-2">
              <p className="text-sm text-slate-200">{peakWeekToday.focus}</p>
            </div>

            <div className="space-y-2">
              <div className="bg-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">Calories</span>
                <span className="text-base font-bold text-emerald-400">
                  {peakWeekToday.calories.toLocaleString()}
                  <span className="text-xs font-normal text-slate-500 ml-1">kcal</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Protein",  value: peakWeekToday.proteinG,                        unit: "g",    color: "#60a5fa" },
                  { label: "Carbs",    value: peakWeekToday.carbsG,                          unit: "g",    color: "#fbbf24" },
                  { label: "Fat",      value: peakWeekToday.fatG,                            unit: "g",    color: "#fb7185" },
                  { label: "Sodium",   value: +(peakWeekToday.sodiumMg / 1000).toFixed(1),  unit: "g Na", color: "#60a5fa" },
                ].map(({ label, value, unit, color }) => (
                  <div key={label} className="bg-slate-800 rounded-xl px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-slate-500">{label}</span>
                    <span className="text-sm font-bold" style={{ color }}>
                      {value}<span className="text-[11px] font-normal text-slate-500 ml-0.5">{unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl px-3 py-2.5">
              <Droplets className="w-4 h-4 text-sky-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-sky-400">Water today: {peakWeekToday.waterL}</p>
                <p className="text-xs text-slate-500">Stay consistent throughout the day</p>
              </div>
            </div>

            {peakWeekToday.guidance?.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-3 h-3 text-slate-500" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Today's focus</span>
                </div>
                {peakWeekToday.guidance.map((g: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">•</span>
                    <span>{g}</span>
                  </div>
                ))}
              </div>
            )}

            {(peakWeekToday.foods?.length > 0 || peakWeekToday.avoid?.length > 0) && (
              <div className="grid grid-cols-2 gap-3">
                {peakWeekToday.foods?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs font-semibold text-emerald-400">Eat</span>
                    </div>
                    {peakWeekToday.foods.map((f: string, i: number) => (
                      <div key={i} className="text-xs text-slate-500">• {f}</div>
                    ))}
                  </div>
                )}
                {peakWeekToday.avoid?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs font-semibold text-rose-400">Avoid</span>
                    </div>
                    {peakWeekToday.avoid.map((f: string, i: number) => (
                      <div key={i} className="text-xs text-slate-500">• {f}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Hero: Calorie Ring */}
        <div className="flex justify-center">
          <ProgressRing value={caloriesConsumed} max={calorieGoal} size={200} strokeWidth={16} color="#34d399">
            <span className="text-4xl font-bold text-slate-100">{caloriesConsumed}</span>
            <span className="text-sm text-slate-500">kcal</span>
            <span className="text-xs text-slate-400 mt-1">
              {calRemain >= 0 ? `${calRemain} remaining` : `${Math.abs(calRemain)} over`}
            </span>
          </ProgressRing>
        </div>

        {/* Macro mini-cards row */}
        <div className="flex gap-3">
          {/* Protein */}
          <div className="flex-1 surface-card p-3">
            <p className="text-xs text-slate-400 mb-1">Protein</p>
            <p className="text-base font-bold text-blue-400" style={{ fontFamily: "var(--font-display)" }}>{protein}g</p>
            <p className="text-xs text-slate-500">/ {proteinGoal}g</p>
            <div className="mt-2 h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(protein / proteinGoal * 100, 100)}%`,
                  background: "linear-gradient(90deg, #60a5fa, #93c5fd)",
                  boxShadow: "0 0 8px rgba(96,165,250,0.4)",
                }}
              />
            </div>
          </div>
          {/* Carbs */}
          <div className="flex-1 surface-card p-3">
            <p className="text-xs text-slate-400 mb-1">Carbs</p>
            <p className="text-base font-bold text-amber-400" style={{ fontFamily: "var(--font-display)" }}>{carbs}g</p>
            <p className="text-xs text-slate-500">/ {carbsGoal}g</p>
            <div className="mt-2 h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(carbs / carbsGoal * 100, 100)}%`,
                  background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
                  boxShadow: "0 0 8px rgba(245,158,11,0.4)",
                }}
              />
            </div>
          </div>
          {/* Fats */}
          <div className="flex-1 surface-card p-3">
            <p className="text-xs text-slate-400 mb-1">Fats</p>
            <p className="text-base font-bold text-rose-400" style={{ fontFamily: "var(--font-display)" }}>{fat}g</p>
            <p className="text-xs text-slate-500">/ {fatGoal}g</p>
            <div className="mt-2 h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(fat / fatGoal * 100, 100)}%`,
                  background: "linear-gradient(90deg, #fb7185, #fda4af)",
                  boxShadow: "0 0 8px rgba(251,113,133,0.4)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Daily Micronutrients */}
        <DailyMicros date={today} />

        {/* Training Today Card */}
        {trainingToday && (
          <Link href="/training">
            <div className="surface-card p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/60 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <Dumbbell className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-400 truncate">
                    Week {trainingToday.weekNumber} · {trainingToday.dayLabel}
                  </p>
                  <p className="text-sm font-semibold text-slate-100 truncate">
                    {trainingToday.exerciseCount} exercise{trainingToday.exerciseCount !== 1 ? "s" : ""}
                    <span className="text-xs font-normal text-slate-500 ml-1.5">{trainingToday.programName}</span>
                  </p>
                </div>
              </div>
              {trainingToday.alreadyLogged ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0">
                  <Check className="w-3.5 h-3.5" />
                  Logged
                </span>
              ) : (
                <span className="text-xs text-slate-400 flex-shrink-0">Log Workout →</span>
              )}
            </div>
          </Link>
        )}

        {/* Recent Meals */}
        <div className="space-y-3">
          <p className="eyebrow">Recent Meals</p>
          {meals.length === 0 ? (
            <div className="surface-card p-8 text-center">
              <UtensilsCrossed className="w-8 h-8 text-slate-500 mx-auto mb-2" />
              <p className="text-sm text-slate-400 mb-3">No meals logged yet</p>
              <Link href="/log">
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white border-0 shadow-[0_0_12px_hsl(158_64%_42%/0.3)]"
                >
                  Log your first meal
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {meals.map((meal: any) => (
                <div
                  key={meal.id}
                  className="surface-card p-4 flex items-center justify-between"
                  data-testid={`meal-card-${meal.id}`}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-100 capitalize">{meal.mealType}</p>
                    <p className="text-xs text-slate-400">{meal.items?.length ?? 0} items</p>
                  </div>
                  <p className="text-emerald-400 font-bold text-sm">{Math.round(meal.totalCalories ?? 0)} <span className="text-slate-500 font-normal">kcal</span></p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Water tracker */}
        {enableWaterTracking && (
          <div className="surface-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-semibold text-slate-200">Water</span>
              </div>
              <span className="text-sky-400 font-semibold text-sm">
                {fmtWater(waterMl)}{waterTargetMl ? ` / ${fmtWater(waterTargetMl)}` : ""}
              </span>
            </div>

            {waterTargetMl && (
              <>
                <div className="bg-slate-800 rounded-full h-2">
                  <div
                    className="h-full rounded-full bg-sky-400 transition-all duration-500"
                    style={{ width: `${waterPct}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {waterGlasses} of {waterTargetGlasses} glasses
                </p>
              </>
            )}

            {/* Bottle-based logging */}
            {waterBottles.length > 0 ? (
              <div className="space-y-2">
                {waterBottles.map((bottle) => (
                  <div key={bottle.id} className="bg-slate-800 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-300">{bottle.name}</span>
                      <span className="text-xs text-slate-500">{fmtWater(bottle.mlSize)} total</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {(["1/4", "1/2", "3/4", "1"] as const).map((frac) => {
                        const fracMap: Record<string, number> = {"1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "1": 1};
                        const addMl = Math.round(bottle.mlSize * fracMap[frac]);
                        return (
                          <button
                            key={frac}
                            onClick={() => waterMutation.mutate(addMl)}
                            disabled={waterMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-sky-400/60 text-xs font-medium text-slate-300 transition-colors"
                          >
                            <Plus className="w-3 h-3" />{frac} <span className="text-slate-500 ml-0.5">({fmtWater(addMl)})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">No bottles saved — add some in Settings for fraction logging. Quick-add:</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {([240, 355, 500, 750] as const).map((ml) => (
                    <button
                      key={ml}
                      onClick={() => waterMutation.mutate(ml)}
                      disabled={waterMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
                    >
                      <Plus className="w-3 h-3" />{fmtWater(ml)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => waterMutation.mutate(-237)}
                disabled={waterMutation.isPending || waterMl === 0}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-400 transition-colors"
              >
                <Minus className="w-3 h-3" /> Undo 8oz
              </button>
              {waterTargetMl && waterMl >= waterTargetMl && (
                <span className="text-xs text-emerald-400 font-medium">Goal reached!</span>
              )}
            </div>
          </div>
        )}

        {/* Weight card */}
        {weightChartData.length > 0 && latestWeight !== null && (
          <div className="surface-card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-200">Weight</span>
              <TrendingUp className="w-4 h-4 text-slate-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-100">{latestWeight}</span>
              <span className="text-sm text-slate-500">lbs</span>
              {weightDelta !== null && weightDelta !== 0 && (
                <span className={`text-sm font-medium ${weightDelta > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {weightDelta > 0 ? "↑" : "↓"} {Math.abs(weightDelta)} lbs
                </span>
              )}
            </div>
            {renderSparkline()}
          </div>
        )}

        {/* Wearable activity */}
        {recentActivity.length > 0 && (
          <div className="surface-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-slate-200">Activity</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {recentActivity.slice(0, 3).map((a: any) => (
                <div key={a.id} className="bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500">{a.date.slice(5)}</p>
                  <p className="font-bold text-sm text-slate-100 mt-0.5">{a.caloriesBurned?.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">kcal</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-600 pb-2">
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400 transition-colors">
            Created with Perplexity Computer
          </a>
        </p>
      </div>
    </div>
  );
}

// ── Daily Micronutrients (collapsible) ────────────────────────────────────────
function DailyMicros({ date }: { date: string }) {
  const { data: micros } = useQuery({
    queryKey: ["/api/nutrition/daily-micros", date],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/nutrition/daily-micros?date=${date}`);
      return res.json();
    },
  });

  const [expanded, setExpanded] = useState(false);

  if (!micros || Object.values(micros).every(v => !v)) return null;

  const items = [
    { label: "Fiber",       value: micros.fiber_g,         unit: "g",  dv: 28,   color: "#a78bfa" },
    { label: "Sugar",       value: micros.sugar_g,         unit: "g",  dv: 50,   color: "#fb923c" },
    { label: "Sat. Fat",    value: micros.saturated_fat_g, unit: "g",  dv: 20,   color: "#f87171" },
    { label: "Cholesterol", value: micros.cholesterol_mg,  unit: "mg", dv: 300,  color: "#fbbf24" },
    { label: "Sodium",      value: micros.sodium_mg,       unit: "mg", dv: 2300, color: "#60a5fa" },
    { label: "Potassium",   value: micros.potassium_mg,    unit: "mg", dv: 4700, color: "#34d399" },
    { label: "Vitamin C",   value: micros.vitamin_c_mg,    unit: "mg", dv: 90,   color: "#fde047" },
    { label: "Calcium",     value: micros.calcium_mg,      unit: "mg", dv: 1300, color: "#e2e8f0" },
    { label: "Iron",        value: micros.iron_mg,         unit: "mg", dv: 18,   color: "#a3a3a3" },
    { label: "Vitamin D",   value: micros.vitamin_d_iu,    unit: "IU", dv: 800,  color: "#fdba74" },
  ].filter(item => item.value != null && item.value > 0);

  if (items.length === 0) return null;

  return (
    <section className="surface-card p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-200">
          <Pill className="w-4 h-4 text-purple-400" />
          Daily Micronutrients
        </h3>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {items.map(item => {
            const pct = Math.min(100, (item.value / item.dv) * 100);
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">{item.label}</span>
                  <span className="font-medium text-slate-300">{item.value}{item.unit}</span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: item.color }}
                  />
                </div>
                <span className="text-[10px] text-slate-500">{Math.round(pct)}% DV</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
