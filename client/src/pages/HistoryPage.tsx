import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getToken, fmt1, formatDate, kgToLbs } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function HistoryPage() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const startDate = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const endDate = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(getDaysInMonth(viewYear, viewMonth)).padStart(2, "0")}`;

  const { data: mealsRange = [], isLoading: mealsLoading } = useQuery<any[]>({
    queryKey: ["/api/meals/range", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/meals/range?startDate=${startDate}&endDate=${endDate}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: weightLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/weight"],
    queryFn: async () => {
      const res = await fetch("/api/weight?limit=365", { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Build a map of date -> { calories, weight }
  const dateMap: Record<string, { calories: number; meals: any[] }> = {};
  for (const meal of mealsRange) {
    if (!dateMap[meal.date]) dateMap[meal.date] = { calories: 0, meals: [] };
    dateMap[meal.date].calories += meal.totalCalories ?? 0;
    dateMap[meal.date].meals.push(meal);
  }

  const weightMap: Record<string, number> = {};
  for (const w of weightLogs) {
    weightMap[w.date] = w.weightKg;
  }

  const days = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth).toLocaleString("en-US", { month: "long" });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  const selectedMeals = selectedDate ? (dateMap[selectedDate]?.meals ?? []) : [];

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">History</h1>

      {/* Calendar */}
      <div className="bg-card border border-border rounded-xl p-4">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-secondary" data-testid="button-prev-month">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="font-semibold text-sm">{monthName} {viewYear}</p>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-secondary" data-testid="button-next-month">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7 gap-1">
          {/* Empty cells for first week */}
          {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}

          {Array.from({ length: days }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const hasMeals = !!dateMap[dateStr];
            const isToday = dateStr === today.toISOString().slice(0, 10);
            const isSelected = dateStr === selectedDate;

            return (
              <button
                key={day}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                data-testid={`calendar-day-${dateStr}`}
                className={`
                  aspect-square rounded-lg text-xs font-medium flex flex-col items-center justify-center relative transition-colors
                  ${isSelected ? "bg-primary text-primary-foreground" : ""}
                  ${!isSelected && isToday ? "border border-primary text-primary" : ""}
                  ${!isSelected && !isToday && hasMeals ? "bg-secondary text-foreground hover:bg-primary/20" : ""}
                  ${!isSelected && !isToday && !hasMeals ? "text-muted-foreground hover:bg-secondary" : ""}
                `}
              >
                {day}
                {hasMeals && !isSelected && (
                  <div className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="font-semibold">{formatDate(selectedDate)}</h2>

          {weightMap[selectedDate] && (
            <p className="text-sm text-muted-foreground">
              Weight: <span className="text-foreground font-medium">{kgToLbs(weightMap[selectedDate])} lbs</span>
            </p>
          )}

          {selectedMeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meals logged</p>
          ) : (
            <div className="space-y-2">
              {selectedMeals.map((meal: any) => (
                <div key={meal.id} className="p-3 bg-secondary rounded-lg" data-testid={`history-meal-${meal.id}`}>
                  <div className="flex justify-between items-center">
                    <p className="font-medium capitalize text-sm">{meal.mealType}</p>
                    <p className="text-sm font-semibold">{Math.round(meal.totalCalories ?? 0)} kcal</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    P:{fmt1(meal.totalProtein)}g · C:{fmt1(meal.totalCarbs)}g · F:{fmt1(meal.totalFat)}g
                  </p>
                </div>
              ))}
              <div className="pt-1 border-t border-border flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span>{Math.round(dateMap[selectedDate]?.calories ?? 0)} kcal</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
