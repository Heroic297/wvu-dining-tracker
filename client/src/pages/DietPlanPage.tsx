import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getToken, kgToLbs, todayStr } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Droplets, Target, Zap, Dumbbell } from "lucide-react";

export default function DietPlanPage() {
  const { user } = useAuth();
  const today = todayStr();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/targets", today],
    queryFn: async () => {
      const res = await fetch(`/api/targets?date=${today}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to get targets");
      return res.json();
    },
  });

  const { data: weightLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/weight"],
    queryFn: async () => {
      const res = await fetch("/api/weight?limit=30", { headers: { Authorization: `Bearer ${getToken()}` } });
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

  const daysToTarget = user?.targetDate
    ? Math.max(0, Math.round((new Date(user.targetDate).getTime() - Date.now()) / 86400000))
    : null;

  const currentLbs = latestWeight ? kgToLbs(latestWeight) : null;
  const targetLbs = user?.targetWeightKg ? kgToLbs(user.targetWeightKg) : null;
  const lbsRemaining = currentLbs && targetLbs ? Math.abs(targetLbs - currentLbs) : null;

  return (
    <div className="p-4 md:p-6 max-w-xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Diet plan</h1>
        {targets.isTrainingDay !== undefined && (
          <Badge variant={targets.isTrainingDay ? "default" : "secondary"}>
            {targets.isTrainingDay ? "Training day" : "Rest day"}
          </Badge>
        )}
      </div>

      {/* Goal progress */}
      {currentLbs && targetLbs && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Progress</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold">{currentLbs}</p>
              <p className="text-xs text-muted-foreground">Current (lbs)</p>
            </div>
            <div className="flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-semibold text-primary">{lbsRemaining} lbs</p>
                <p className="text-xs text-muted-foreground">to go</p>
              </div>
            </div>
            <div>
              <p className="text-xl font-bold">{targetLbs}</p>
              <p className="text-xs text-muted-foreground">Target (lbs)</p>
            </div>
          </div>
          {daysToTarget !== null && (
            <div className="mt-3 pt-3 border-t border-border flex justify-between text-sm">
              <span className="text-muted-foreground">Days remaining</span>
              <span className="font-semibold">{daysToTarget}</span>
            </div>
          )}
        </div>
      )}

      {/* Daily targets */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
          <Target className="w-4 h-4" /> Daily targets
        </h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm">Calories</span>
            <span className="font-bold text-primary">{targets.calories.toLocaleString()} kcal</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm macro-protein">Protein</span>
            <span className="font-semibold macro-protein">{targets.proteinG}g</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm macro-carbs">Carbohydrates</span>
            <span className="font-semibold macro-carbs">{targets.carbsG}g</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm macro-fat">Fat</span>
            <span className="font-semibold macro-fat">{targets.fatG}g</span>
          </div>
          <div className="pt-2 border-t border-border space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>BMR</span><span>{targets.bmr?.toLocaleString()} kcal</span>
            </div>
            <div className="flex justify-between">
              <span>TDEE</span><span>{targets.tdee?.toLocaleString()} kcal</span>
            </div>
            <div className="flex justify-between">
              <span>Daily {targets.deficit < 0 ? "deficit" : "surplus"}</span>
              <span className={targets.deficit < 0 ? "text-red-400" : "text-green-400"}>
                {Math.abs(targets.deficit)} kcal
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Water cut plan */}
      {waterCutPlan && waterCutPlan.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-2">
            <Droplets className="w-4 h-4 text-blue-400" /> 7-Day Water Cut
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Educational guidance only — consult a sports dietitian.
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
                    {day.daysOut === 1 ? "Meet day -1" : `${day.daysOut} days out`}
                  </span>
                  <div className="flex gap-3 text-xs">
                    <span className="text-primary">{day.targetCalories} kcal</span>
                    <span className="text-blue-400 flex items-center gap-0.5">
                      <Droplets className="w-3 h-3" />{day.waterIntake}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{day.notes}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Powerlifting info */}
      {user?.meetDate && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Dumbbell className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">Powerlifting meet</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Meet date:{" "}
            <span className="text-foreground font-medium">
              {new Date(user.meetDate + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </span>
          </p>
          {daysToTarget !== null && (
            <p className="text-sm text-muted-foreground">
              {daysToTarget} days away
            </p>
          )}
        </div>
      )}
    </div>
  );
}
