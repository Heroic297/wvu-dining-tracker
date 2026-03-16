import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fmt1, todayStr, formatDate, kgToLbs } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PlusCircle, Flame, TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";

function MacroRing({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.min(1, max > 0 ? value / max : 0);
  const r = 28, cx = 32, cy = 32, stroke = 5;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={64} height={64} viewBox="0 0 64 64">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(220 14% 14%)" strokeWidth={stroke} />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dasharray 0.5s ease" }}
        />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="hsl(44 15% 92%)" fontWeight="600">
          {Math.round(value)}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// Inline icon to avoid import issues
function UtensilsCrossed({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>
    </svg>
  );
}

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

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const totals = data?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const targets = data?.targets;
  const meals = data?.meals ?? [];
  const recentActivity = data?.activities ?? [];

  // Weight chart data
  const weightChartData = (weightData ?? [])
    .slice(0, 14)
    .reverse()
    .map((w: any) => ({
      date: w.date.slice(5), // MM-DD
      lbs: kgToLbs(w.weightKg),
    }));

  const calPct = targets ? Math.min(100, (totals.calories / targets.calories) * 100) : 0;
  const calColor = calPct > 105 ? "#ef4444" : calPct > 90 ? "#22c55e" : "#facc15";

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl">
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

      {/* Calorie ring + macros */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-6">
          {/* Big calorie ring */}
          <div className="relative flex-shrink-0">
            {(() => {
              const r = 44, circ = 2 * Math.PI * r;
              const pct = targets ? Math.min(1, totals.calories / targets.calories) : 0;
              return (
                <svg width={104} height={104} viewBox="0 0 104 104">
                  <circle cx={52} cy={52} r={r} fill="none" stroke="hsl(220 14% 14%)" strokeWidth={8} />
                  <circle
                    cx={52} cy={52} r={r}
                    fill="none" stroke={calColor} strokeWidth={8}
                    strokeLinecap="round"
                    strokeDasharray={`${circ * pct} ${circ}`}
                    transform="rotate(-90 52 52)"
                    style={{ transition: "stroke-dasharray 0.6s ease" }}
                  />
                  <text x={52} y={46} textAnchor="middle" fontSize="18" fontWeight="700" fill="hsl(44 15% 92%)">
                    {Math.round(totals.calories)}
                  </text>
                  <text x={52} y={63} textAnchor="middle" fontSize="11" fill="hsl(220 8% 50%)">
                    {targets ? `/ ${targets.calories}` : "kcal"}
                  </text>
                </svg>
              );
            })()}
          </div>

          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">Calories consumed</p>
            {targets && (
              <p className="text-xs text-muted-foreground">
                {Math.round(targets.calories - totals.calories)} kcal remaining
              </p>
            )}
            <div className="flex gap-4 mt-3">
              <MacroRing value={totals.protein} max={targets?.proteinG ?? 160} color="#4ade80" label="Protein" />
              <MacroRing value={totals.carbs} max={targets?.carbsG ?? 250} color="#facc15" label="Carbs" />
              <MacroRing value={totals.fat} max={targets?.fatG ?? 70} color="#fb923c" label="Fat" />
            </div>
          </div>
        </div>
      </div>

      {/* Meals list */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Today's meals</h2>
        {meals.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-6 text-center">
            <UtensilsCrossed className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No meals logged yet</p>
            <Link href="/log">
              <Button variant="outline" size="sm" className="mt-3">Log your first meal</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {meals.map((meal: any) => (
              <div key={meal.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between" data-testid={`meal-card-${meal.id}`}>
                <div>
                  <p className="font-medium capitalize text-sm">{meal.mealType}</p>
                  <p className="text-xs text-muted-foreground">{meal.items?.length ?? 0} items</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{Math.round(meal.totalCalories ?? 0)} kcal</p>
                  <p className="text-xs text-muted-foreground">
                    P:{fmt1(meal.totalProtein)}g · C:{fmt1(meal.totalCarbs)}g · F:{fmt1(meal.totalFat)}g
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weight chart */}
      {weightChartData.length > 1 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Weight (14 days)</h2>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={weightChartData}>
              <defs>
                <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#eab308" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#eab308" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "hsl(220 18% 9%)", border: "1px solid hsl(220 12% 16%)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v} lbs`, "Weight"]}
              />
              <Area type="monotone" dataKey="lbs" stroke="#eab308" fill="url(#wGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Wearable activity */}
      {recentActivity.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-orange-400" />
            <h2 className="text-sm font-semibold">Activity</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {recentActivity.slice(0, 3).map((a: any) => (
              <div key={a.id} className="bg-secondary rounded-lg p-2 text-center">
                <p className="text-xs text-muted-foreground">{a.date.slice(5)}</p>
                <p className="font-semibold text-sm">{a.caloriesBurned?.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">kcal</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
