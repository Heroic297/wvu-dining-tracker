import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { kgToLbs, todayStr } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Droplets, Target, Dumbbell, Waves } from "lucide-react";

/** Round to 1 decimal place */
function r1(n: number) {
  return Math.round(n * 10) / 10;
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

  const currentLbs = latestWeight ? r1(kgToLbs(latestWeight)) : null;
  const targetLbs  = user?.targetWeightKg ? r1(kgToLbs(user.targetWeightKg)) : null;

  // Water cut buffer: stop diet ~1% of current bodyweight above target,
  // leaving that room for the water cut to handle.
  const waterCutEnabled = !!user?.enableWaterCut;
  const bufferLbs = currentLbs ? r1(currentLbs * 0.01) : 0;

  // Effective diet target when water cut is on = actual target + 1% buffer
  const dietTargetLbs = targetLbs !== null && waterCutEnabled
    ? r1(targetLbs + bufferLbs)
    : targetLbs;

  const lbsRemaining = currentLbs !== null && dietTargetLbs !== null
    ? r1(Math.abs(dietTargetLbs - currentLbs))
    : null;

  const isGain = user?.goalType?.includes("gain");

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
      {currentLbs !== null && targetLbs !== null && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Progress</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold">{currentLbs}</p>
              <p className="text-xs text-muted-foreground">Current (lbs)</p>
            </div>

            {/* Centre: lbs to go */}
            <div className="flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-semibold text-primary">{lbsRemaining} lbs</p>
                <p className="text-xs text-muted-foreground">to go</p>
                {waterCutEnabled && (
                  <p className="text-xs text-blue-400 mt-0.5 flex items-center justify-center gap-0.5">
                    <Waves className="w-3 h-3" />
                    +{bufferLbs} for cut
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="text-xl font-bold">{targetLbs}</p>
              <p className="text-xs text-muted-foreground">Target (lbs)</p>
            </div>
          </div>

          {/* Water cut buffer explanation */}
          {waterCutEnabled && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-blue-400 flex items-start gap-1.5">
                <Waves className="w-3 h-3 mt-0.5 flex-shrink-0" />
                Diet to <span className="font-semibold text-foreground">{dietTargetLbs} lbs</span> — the final {bufferLbs} lbs ({`1% bodyweight`}) is reserved for your water cut.
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
                    {day.daysOut === 1 ? "Meet day −1" : `${day.daysOut} days out`}
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

      {/* Powerlifting meet info */}
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
            <p className="text-sm text-muted-foreground mt-0.5">{daysToTarget} days away</p>
          )}
        </div>
      )}
    </div>
  );
}
