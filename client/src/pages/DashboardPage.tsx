import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { fmt1, todayStr, formatDate, kgToLbs, api } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PlusCircle, Flame, TrendingUp, UtensilsCrossed, Trophy, Droplets, Plus, Minus } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── Macro token colours (CSS vars resolved at runtime) ─────────────────────
const TOKEN = {
  protein:  "var(--color-protein)",
  carbs:    "var(--color-carbs)",
  fat:      "var(--color-fat)",
  calories: "var(--color-calories)",
};

// Hex fallbacks for recharts (can't use CSS vars in SVG attrs via recharts)
const HEX = {
  protein:  "#34d399",
  carbs:    "#f59e0b",
  fat:      "#fb923c",
  calories: "#34d399",
};

// ── Ring component ──────────────────────────────────────────────────────────
function MacroRing({
  value, max, color, label,
}: {
  value: number; max: number; color: string; label: string;
}) {
  const pct = Math.min(1, max > 0 ? value / max : 0);
  const r = 26, cx = 32, cy = 32, sw = 5;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={64} height={64} viewBox="0 0 64 64">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={sw} />
        {/* Fill */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dasharray 0.55s cubic-bezier(0.34,1.56,0.64,1)" }}
        />
        <text
          x={cx} y={cy}
          textAnchor="middle" dominantBaseline="central"
          fontSize="11" fontWeight="700"
          fill="hsl(var(--foreground))"
        >
          {Math.round(value)}
        </text>
      </svg>
      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

// ── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color: accent ?? "hsl(var(--foreground))" }}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const today = todayStr();

  const { data, isLoading } = useQuery({
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

  // ALL hooks must be declared before any early returns
  const waterMutation = useMutation({
    mutationFn: async (delta: number) => {
      const newVal = Math.max(0, waterMl + delta);
      const res = await api.logWater(today, newVal);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-5 max-w-3xl">
        <Skeleton className="h-7 w-36 rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
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

  // Auto-window Y axis — zoom in tight on actual variation
  const weightVals = weightChartData.map((d: any) => d.lbs as number);
  const weightMin = weightVals.length ? Math.min(...weightVals) : 150;
  const weightMax = weightVals.length ? Math.max(...weightVals) : 160;
  const weightPad = Math.max(0.5, (weightMax - weightMin) * 0.4);
  const yDomain: [number, number] = [
    +((weightMin - weightPad).toFixed(1)),
    +((weightMax + weightPad).toFixed(1)),
  ];

  const calPct   = targets ? Math.min(100, (totals.calories / targets.calories) * 100) : 0;
  const calRemain = targets ? Math.round(targets.calories - totals.calories) : null;
  // Colour the calorie ring: green when on track, amber nearing cap, red over
  const calStroke =
    calPct > 105 ? "#ef4444"
    : calPct > 92  ? HEX.protein
    : HEX.calories;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl fade-up">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Today</h1>
          <p className="text-sm text-muted-foreground">{formatDate(today)}</p>
        </div>
        <Link href="/log">
          <Button size="sm" data-testid="button-log-meal">
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Log meal
          </Button>
        </Link>
      </div>

      {/* Peak week card */}
      {peakWeekToday && (
        <div className={`rounded-2xl border p-4 space-y-3 ${
          peakWeekToday.isKeyDay
            ? "border-primary/60 bg-primary/5"
            : "border-border bg-card"
        }`}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-widest text-primary">Peak Week · Today</span>
            </div>
            <span className="text-xs font-semibold bg-secondary px-2.5 py-1 rounded-full">
              {peakWeekToday.daysOut === 0 ? "Meet day" : `${peakWeekToday.daysOut} days out`}
            </span>
          </div>

          {/* Phase */}
          <div>
            <p className="text-lg font-bold leading-tight">{peakWeekToday.phase}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{peakWeekToday.label}</p>
          </div>

          {/* Focus */}
          <div className="bg-background/60 rounded-xl px-3 py-2">
            <p className="text-sm text-foreground">{peakWeekToday.focus}</p>
          </div>

          {/* Macro targets */}
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: "Calories", value: `${peakWeekToday.calories}`, unit: "kcal", color: HEX.calories },
              { label: "Protein",  value: `${peakWeekToday.proteinG}`, unit: "g",    color: HEX.protein },
              { label: "Carbs",    value: `${peakWeekToday.carbsG}`,   unit: "g",    color: HEX.carbs },
              { label: "Fat",      value: `${peakWeekToday.fatG}`,     unit: "g",    color: HEX.fat },
              { label: "Sodium",   value: `${(peakWeekToday.sodiumMg/1000).toFixed(1)}`, unit: "g Na", color: "#60a5fa" },
            ].map(({ label, value, unit, color }) => (
              <div key={label} className="bg-secondary rounded-xl p-2 text-center">
                <p className="text-sm font-bold" style={{ color }}>{value}<span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span></p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Water */}
          <div className="flex items-center gap-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2.5">
            <Droplets className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-blue-400">Water today: {peakWeekToday.waterL}</p>
              <p className="text-xs text-muted-foreground">Stay consistent throughout the day</p>
            </div>
          </div>

          {/* Guidance bullets */}
          {peakWeekToday.guidance?.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Flame className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Today's focus</span>
              </div>
              {peakWeekToday.guidance.map((g: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-primary mt-0.5 flex-shrink-0">•</span>
                  <span>{g}</span>
                </div>
              ))}
            </div>
          )}

          {/* Eat / Avoid */}
          {(peakWeekToday.foods?.length > 0 || peakWeekToday.avoid?.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {peakWeekToday.foods?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-xs font-semibold text-emerald-400">Eat</span>
                  </div>
                  {peakWeekToday.foods.map((f: string, i: number) => (
                    <div key={i} className="text-xs text-muted-foreground">• {f}</div>
                  ))}
                </div>
              )}
              {peakWeekToday.avoid?.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-xs font-semibold text-destructive">Avoid</span>
                  </div>
                  {peakWeekToday.avoid.map((f: string, i: number) => (
                    <div key={i} className="text-xs text-muted-foreground">• {f}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Calorie ring + macros */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-6">
          {/* Big calorie ring */}
          <div className="relative flex-shrink-0">
            {(() => {
              const r = 44, circ = 2 * Math.PI * r;
              const pct = targets ? Math.min(1, totals.calories / targets.calories) : 0;
              return (
                <svg width={108} height={108} viewBox="0 0 108 108">
                  {/* Outer glow track */}
                  <circle cx={54} cy={54} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={9} />
                  <circle
                    cx={54} cy={54} r={r}
                    fill="none"
                    stroke={calStroke}
                    strokeWidth={9}
                    strokeLinecap="round"
                    strokeDasharray={`${circ * pct} ${circ}`}
                    transform="rotate(-90 54 54)"
                    style={{ transition: "stroke-dasharray 0.65s cubic-bezier(0.34,1.56,0.64,1), stroke 0.3s ease" }}
                  />
                  <text x={54} y={49} textAnchor="middle" fontSize="20" fontWeight="800" fill="hsl(var(--foreground))" fontFamily="var(--font-display)">
                    {Math.round(totals.calories)}
                  </text>
                  <text x={54} y={66} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                    {targets ? `/ ${targets.calories} kcal` : "kcal"}
                  </text>
                </svg>
              );
            })()}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold mb-0.5">Calories</p>
            {calRemain !== null && (
              <p className="text-xs text-muted-foreground mb-3">
                {calRemain >= 0
                  ? <><span className="text-foreground font-medium">{calRemain}</span> kcal remaining</>
                  : <><span className="text-destructive font-medium">{Math.abs(calRemain)}</span> kcal over</>}
              </p>
            )}
            <div className="flex gap-5">
              <MacroRing value={totals.protein} max={targets?.proteinG ?? 160} color={TOKEN.protein} label="Protein" />
              <MacroRing value={totals.carbs}   max={targets?.carbsG   ?? 250} color={TOKEN.carbs}   label="Carbs" />
              <MacroRing value={totals.fat}     max={targets?.fatG     ?? 70}  color={TOKEN.fat}     label="Fat" />
            </div>
          </div>
        </div>
      </div>

      {/* Stat row */}
      {targets && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Protein goal" value={`${targets.proteinG}g`} sub={`${fmt1(totals.protein)}g logged`} accent={HEX.protein} />
          <StatCard label="Carb goal"    value={`${targets.carbsG}g`}   sub={`${fmt1(totals.carbs)}g logged`}   accent={HEX.carbs} />
          <StatCard label="Fat goal"     value={`${targets.fatG}g`}     sub={`${fmt1(totals.fat)}g logged`}     accent={HEX.fat} />
        </div>
      )}

      {/* Water tracker */}
      {enableWaterTracking && waterTargetMl !== null && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold">Water intake</h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {(waterMl / 1000).toFixed(2).replace(/\.?0+$/, '')}L / {(waterTargetMl / 1000).toFixed(1)}L
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden mb-3">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (waterMl / waterTargetMl) * 100)}%`,
                background: waterMl >= waterTargetMl ? "#22c55e" : "#60a5fa",
              }}
            />
          </div>

          {/* Quick add buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {[150, 250, 350, 500].map((ml) => (
              <button
                key={ml}
                onClick={() => waterMutation.mutate(ml)}
                disabled={waterMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-xs font-medium transition-colors"
              >
                <Plus className="w-3 h-3" />{ml}ml
              </button>
            ))}
            <button
              onClick={() => waterMutation.mutate(-250)}
              disabled={waterMutation.isPending || waterMl === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-xs font-medium transition-colors text-muted-foreground ml-auto"
            >
              <Minus className="w-3 h-3" />250ml
            </button>
          </div>

          {waterMl >= waterTargetMl && (
            <p className="text-xs text-emerald-400 font-medium mt-2 text-center">Daily water goal reached 🎉</p>
          )}
        </div>
      )}

      {/* Today's meals */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Today's meals</h2>
        {meals.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <UtensilsCrossed className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">No meals logged yet</p>
            <Link href="/log">
              <Button variant="outline" size="sm">Log your first meal</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {meals.map((meal: any) => (
              <div
                key={meal.id}
                className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between hover:border-primary/30 transition-colors"
                data-testid={`meal-card-${meal.id}`}
              >
                <div>
                  <p className="font-semibold text-sm capitalize">{meal.mealType}</p>
                  <p className="text-xs text-muted-foreground">{meal.items?.length ?? 0} items</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm" style={{ color: HEX.calories }}>{Math.round(meal.totalCalories ?? 0)} kcal</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="macro-protein">P:{fmt1(meal.totalProtein)}g</span>
                    {" · "}
                    <span className="macro-carbs">C:{fmt1(meal.totalCarbs)}g</span>
                    {" · "}
                    <span className="macro-fat">F:{fmt1(meal.totalFat)}g</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weight chart */}
      {weightChartData.length > 1 && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Weight trend</h2>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={weightChartData} margin={{ left: 0, right: 8 }}>
              <defs>
                <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={HEX.calories} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={HEX.calories} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(220 8% 50%)" }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 10, fill: "hsl(220 8% 50%)" }}
                axisLine={false} tickLine={false}
                tickCount={4}
                tickFormatter={(v: number) => `${v}`}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 10, fontSize: 12,
                  color: "hsl(var(--foreground))",
                }}
                formatter={(v: number) => [`${v} lbs`, "Weight"]}
              />
              <Area
                type="monotone" dataKey="lbs"
                stroke={HEX.calories} fill="url(#wGrad)"
                strokeWidth={2} dot={{ r: 3, fill: HEX.calories, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Wearable activity */}
      {recentActivity.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4" style={{ color: HEX.fat }} />
            <h2 className="text-sm font-semibold">Activity</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {recentActivity.slice(0, 3).map((a: any) => (
              <div key={a.id} className="bg-secondary rounded-xl p-3 text-center">
                <p className="text-xs text-muted-foreground">{a.date.slice(5)}</p>
                <p className="font-bold text-sm mt-0.5">{a.caloriesBurned?.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">kcal</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground pb-2">
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
          Created with Perplexity Computer
        </a>
      </p>
    </div>
  );
}
