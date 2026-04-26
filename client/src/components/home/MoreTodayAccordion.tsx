import { useState } from "react";
import { ChevronDown, Droplets, TrendingUp, Flame, Plus, Minus, Pill } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { api, kgToLbs } from "@/lib/api";

interface WaterProps {
  waterMl: number;
  waterTargetMl: number | null;
  waterUnit: "ml" | "oz" | "L" | "gal";
  waterBottles: Array<{ id: string; name: string; mlSize: number }>;
  enableWaterTracking: boolean;
  today: string;
}

interface ActivityEntry {
  id: string | number;
  date: string;
  caloriesBurned?: number;
}

interface Props {
  date: string;
  water: WaterProps;
  weightData: Array<{ date: string; weightKg: number }> | undefined;
  activities: ActivityEntry[];
  targetWeightKg?: number | null;
}

const ML_TO: Record<string, number> = { ml: 1, oz: 1/29.5735, L: 1/1000, gal: 1/3785.41 };
const UNIT_LABEL: Record<string, string> = { ml: "ml", oz: "oz", L: "L", gal: "gal" };

function fmtWater(ml: number, unit: string) {
  const val = +(ml * ML_TO[unit]).toFixed(unit === "ml" ? 0 : 2);
  return `${val} ${UNIT_LABEL[unit]}`;
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 64, h = 24;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-2">
      <polyline points={points} fill="none" stroke="#34d399" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicrosSection({ date }: { date: string }) {
  const { data: micros } = useQuery({
    queryKey: ["/api/nutrition/daily-micros", date],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/nutrition/daily-micros?date=${date}`);
      return res.json();
    },
  });

  if (!micros) return null;

  const items = [
    { label: "Fiber",       value: micros.fiber_g,         unit: "g",  dv: 28,   color: "#a78bfa" },
    { label: "Sugar",       value: micros.sugar_g,         unit: "g",  dv: 50,   color: "#fb923c" },
    { label: "Sat. Fat",    value: micros.saturated_fat_g, unit: "g",  dv: 20,   color: "#f87171" },
    { label: "Sodium",      value: micros.sodium_mg,       unit: "mg", dv: 2300, color: "#60a5fa" },
    { label: "Potassium",   value: micros.potassium_mg,    unit: "mg", dv: 4700, color: "#34d399" },
    { label: "Vitamin C",   value: micros.vitamin_c_mg,    unit: "mg", dv: 90,   color: "#fde047" },
    { label: "Calcium",     value: micros.calcium_mg,      unit: "mg", dv: 1300, color: "#e2e8f0" },
    { label: "Iron",        value: micros.iron_mg,         unit: "mg", dv: 18,   color: "#a3a3a3" },
  ].filter(i => i.value != null && i.value > 0);

  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Pill className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-xs font-semibold text-slate-400">Micronutrients</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => {
          const pct = Math.min(100, (item.value / item.dv) * 100);
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{item.label}</span>
                <span className="font-medium text-slate-300">{item.value}{item.unit}</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: item.color }} />
              </div>
              <span className="text-[10px] text-slate-500">{Math.round(pct)}% DV</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MoreTodayAccordion({ date, water, weightData, activities, targetWeightKg }: Props) {
  const [open, setOpen] = useState(false);
  const { waterMl, waterTargetMl, waterUnit, waterBottles, enableWaterTracking, today } = water;

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

  const weightChartData = (weightData ?? [])
    .slice(0, 7)
    .reverse()
    .map(w => kgToLbs(w.weightKg));
  const latestWeight = weightChartData.length > 0 ? +weightChartData[weightChartData.length - 1].toFixed(1) : null;
  const prevWeight = weightChartData.length > 1 ? weightChartData[weightChartData.length - 2] : null;
  const weightDelta = latestWeight !== null && prevWeight !== null ? +(latestWeight - prevWeight).toFixed(1) : null;

  const weightDeltaColor = (() => {
    if (targetWeightKg != null && latestWeight !== null && prevWeight !== null) {
      const targetLbs = kgToLbs(targetWeightKg);
      return Math.abs(latestWeight - targetLbs) < Math.abs(prevWeight - targetLbs)
        ? "text-emerald-400"
        : "text-rose-400";
    }
    return weightDelta !== null && weightDelta > 0 ? "text-rose-400" : "text-emerald-400";
  })();

  const waterPct = waterTargetMl
    ? Math.min(100, (waterMl / waterTargetMl) * 100)
    : Math.min(100, ((waterMl / 237) / 8) * 100);

  const hasContent = enableWaterTracking || (latestWeight !== null) || activities.length > 0;
  if (!hasContent) return null;

  const hasAccordionContent = activities.length > 0;

  return (
    <div className="surface-card overflow-hidden">

      {/* Always-visible: Water */}
      {enableWaterTracking && (
        <div className={cn("px-4 pt-4 pb-4 space-y-3", (latestWeight !== null || hasAccordionContent) && "border-b border-white/5")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-semibold text-slate-400">Water</span>
            </div>
            <span className="text-sky-400 font-semibold text-xs">
              {fmtWater(waterMl, waterUnit)}{waterTargetMl ? ` / ${fmtWater(waterTargetMl, waterUnit)}` : ""}
            </span>
          </div>
          {waterTargetMl && (
            <div className="bg-slate-800 rounded-full h-2">
              <div className="h-full rounded-full bg-sky-400 transition-all duration-500" style={{ width: `${waterPct}%` }} />
            </div>
          )}
          {waterBottles.length > 0 ? (
            <div className="space-y-2">
              {waterBottles.map(bottle => (
                <div key={bottle.id} className="bg-slate-800/60 rounded-xl p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-slate-300">{bottle.name}</span>
                    <span className="text-xs text-slate-500">{fmtWater(bottle.mlSize, waterUnit)}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {(["1/4", "1/2", "3/4", "1"] as const).map(frac => {
                      const fracMap: Record<string, number> = {"1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "1": 1};
                      const addMl = Math.round(bottle.mlSize * fracMap[frac]);
                      return (
                        <button
                          key={frac}
                          onClick={() => waterMutation.mutate(addMl)}
                          disabled={waterMutation.isPending}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-sky-400/60 text-xs font-medium text-slate-300 transition-colors"
                        >
                          <Plus className="w-3 h-3" />{frac}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {([240, 355, 500, 750] as const).map(ml => (
                <button
                  key={ml}
                  onClick={() => waterMutation.mutate(ml)}
                  disabled={waterMutation.isPending}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
                >
                  <Plus className="w-3 h-3" />{fmtWater(ml, waterUnit)}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => waterMutation.mutate(-237)}
            disabled={waterMutation.isPending || waterMl === 0}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-400 transition-colors"
          >
            <Minus className="w-3 h-3" /> Undo 8oz
          </button>
        </div>
      )}

      {/* Always-visible: Weight */}
      {latestWeight !== null && (
        <div className={cn("px-4 pt-4 pb-4", hasAccordionContent && "border-b border-white/5")}>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-400">Weight</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-100">{latestWeight}</span>
            <span className="text-sm text-slate-500">lbs</span>
            {weightDelta !== null && weightDelta !== 0 && (
              <span className={`text-xs font-medium ${weightDeltaColor}`}>
                {weightDelta > 0 ? "↑" : "↓"} {Math.abs(weightDelta)}
              </span>
            )}
          </div>
          <Sparkline data={weightChartData} />
        </div>
      )}

      {/* Collapsible: Micros + Activity */}
      {hasAccordionContent && (
        <>
          <button
            onClick={() => setOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3"
          >
            <span className="text-sm font-semibold text-slate-300">More today</span>
            <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform duration-200", open && "rotate-180")} />
          </button>

          {open && (
            <div className="px-4 pb-4 space-y-5 border-t border-white/5 pt-4">
              {/* Micronutrients */}
              <MicrosSection date={date} />

              {/* Activity */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Flame className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-xs font-semibold text-slate-400">Activity</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {activities.slice(0, 3).map((a) => (
                    <div key={a.id} className="bg-slate-800 rounded-xl p-2.5 text-center">
                      <p className="text-xs text-slate-500">{a.date.slice(5)}</p>
                      <p className="font-bold text-sm text-slate-100 mt-0.5">{a.caloriesBurned?.toLocaleString()}</p>
                      <p className="text-xs text-slate-500">kcal</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
