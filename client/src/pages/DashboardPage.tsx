import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { todayStr, formatDate } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import DailyEnergyCard from "@/components/home/DailyEnergyCard";
import TrainingTodayRow from "@/components/home/TrainingTodayRow";
import RecentMealsList from "@/components/home/RecentMealsList";
import MoreTodayAccordion from "@/components/home/MoreTodayAccordion";
import PeakWeekCard from "@/components/home/PeakWeekCard";
import QuickLogSheet from "@/components/home/QuickLogSheet";

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

  if (isLoading) {
    return (
      <div className="min-h-screen text-slate-100 pb-24">
        <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">
          <Skeleton className="h-7 w-36 rounded-lg bg-slate-800/60" />
          <div className="flex justify-center">
            <Skeleton className="h-[220px] w-full rounded-2xl bg-slate-800/60" />
          </div>
          <Skeleton className="h-16 rounded-2xl bg-slate-800/60" />
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

  const totals  = data?.totals  ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const targets = data?.targets;
  const meals   = data?.meals   ?? [];
  const activities = data?.activities ?? [];
  const peakWeekToday = data?.peakWeekToday ?? null;

  const waterProps = {
    waterMl:             data?.waterMl ?? 0,
    waterTargetMl:       data?.waterTargetMl ?? null,
    waterUnit:           (data?.waterUnit ?? "oz") as "ml" | "oz" | "L" | "gal",
    waterBottles:        (data?.waterBottles ?? []) as Array<{ id: string; name: string; mlSize: number }>,
    enableWaterTracking: data?.enableWaterTracking ?? false,
    today,
  };

  const trainingToday = data?.trainingToday as {
    programName: string;
    weekNumber: number;
    dayLabel: string;
    exerciseCount: number;
    alreadyLogged: boolean;
  } | null | undefined;

  const calorieGoal = targets?.calories ?? 2000;
  const macros = {
    protein:     totals.protein,
    proteinGoal: targets?.proteinG ?? 160,
    carbs:       totals.carbs,
    carbsGoal:   targets?.carbsG ?? 250,
    fat:         totals.fat,
    fatGoal:     targets?.fatG ?? 70,
  };

  // Only show peak week card within 7 days of meet
  const showPeakWeek = peakWeekToday !== null && (peakWeekToday?.daysOut ?? 99) <= 7;

  return (
    <div className="min-h-screen text-slate-100 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4 fade-up">

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
          <QuickLogSheet />
        </div>

        {/* Hero: calories + macro rings */}
        <DailyEnergyCard
          calories={totals.calories}
          calorieGoal={calorieGoal}
          macros={macros}
        />

        {/* Training Today */}
        {trainingToday && (
          <div className="mt-2">
            <TrainingTodayRow training={trainingToday} />
          </div>
        )}

        {/* Recent Meals */}
        <RecentMealsList meals={meals} />

        {/* More Today: micros, water, weight, activity */}
        <MoreTodayAccordion
          date={today}
          water={waterProps}
          weightData={weightData}
          activities={activities}
          targetWeightKg={data?.targetWeightKg ?? null}
        />

        {/* Peak Week (bottom, only near meet day) */}
        {showPeakWeek && <PeakWeekCard day={peakWeekToday} />}

      </div>
    </div>
  );
}
