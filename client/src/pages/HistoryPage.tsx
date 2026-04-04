import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmt1, formatDate, kgToLbs } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Trash2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HistoryPage() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);
  const { toast } = useToast();
  const stripRef = useRef<HTMLDivElement>(null);

  const startDate = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-01`;
  const endDate = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(getDaysInMonth(viewYear, viewMonth)).padStart(2, "0")}`;

  const { data: mealsRange = [], isLoading: mealsLoading, refetch: refetchMeals } = useQuery<any[]>({
    queryKey: ["/api/meals/range", startDate, endDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meals/range?startDate=${startDate}&endDate=${endDate}`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: weightLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/weight"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/weight?limit=365");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch calorie targets for adherence coloring
  const { data: dashData } = useQuery({
    queryKey: ["/api/dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60000,
  });

  const calorieGoal = dashData?.targets?.calories ?? 2000;
  const proteinGoal = dashData?.targets?.proteinG ?? 150;
  const carbsGoal = dashData?.targets?.carbsG ?? 250;
  const fatGoal = dashData?.targets?.fatG ?? 65;

  // Build date → { calories, protein, carbs, fat, meals } map
  const dateMap: Record<string, { calories: number; protein: number; carbs: number; fat: number; meals: any[] }> = {};
  for (const meal of mealsRange) {
    if (!dateMap[meal.date]) dateMap[meal.date] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: [] };
    dateMap[meal.date].calories += meal.totalCalories ?? 0;
    dateMap[meal.date].protein += meal.totalProtein ?? 0;
    dateMap[meal.date].carbs += meal.totalCarbs ?? 0;
    dateMap[meal.date].fat += meal.totalFat ?? 0;
    dateMap[meal.date].meals.push(meal);
  }

  const weightMap: Record<string, number> = {};
  for (const w of weightLogs) weightMap[w.date] = w.weightKg;

  const days = getDaysInMonth(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth).toLocaleString("en-US", { month: "long" });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  };

  // Delete an entire meal and all its items
  const deleteMeal = async (mealId: string, label: string) => {
    try {
      await api.deleteMeal(mealId);
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      if (expandedMeal === mealId) setExpandedMeal(null);
      toast({ title: `${label} deleted` });
    } catch {
      toast({ title: "Failed to delete meal", variant: "destructive" });
    }
  };

  // Delete a single item from a meal
  const deleteMealItem = async (itemId: string) => {
    try {
      await api.deleteMealItem(itemId);
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meals"] });
      toast({ title: "Item removed" });
    } catch {
      toast({ title: "Failed to remove item", variant: "destructive" });
    }
  };

  const selectedMeals = selectedDate ? (dateMap[selectedDate]?.meals ?? []) : [];

  // Build array of dates for the date strip
  const dateChips = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const dateObj = new Date(viewYear, viewMonth, day);
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { day, dateStr, dayName: DAY_ABBREV[dateObj.getDay()] };
  });

  // Scroll selected date chip into view
  useEffect(() => {
    if (!stripRef.current || !selectedDate) return;
    const idx = dateChips.findIndex((c) => c.dateStr === selectedDate);
    if (idx < 0) return;
    const chip = stripRef.current.children[idx] as HTMLElement | undefined;
    chip?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedDate]);

  // Adherence border color
  function adherenceBorder(calories: number): string {
    const pct = (calories / calorieGoal) * 100;
    if (pct >= 90 && pct <= 110) return "border-emerald-500/30";
    if (pct < 90) return "border-amber-500/30";
    return "border-rose-500/30";
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        {/* Page title */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-100">History</h1>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors" data-testid="button-prev-month">
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>
            <p className="text-sm font-medium text-slate-300">{monthName} {viewYear}</p>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors" data-testid="button-next-month">
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Horizontal scrollable date strip */}
        <div
          ref={stripRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4"
        >
          {dateChips.map(({ day, dateStr, dayName }) => {
            const isSelected = dateStr === selectedDate;
            const todayStr = today.toISOString().slice(0, 10);
            const isToday = dateStr === todayStr;
            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                data-testid={`calendar-day-${dateStr}`}
                className={`
                  flex-shrink-0 rounded-xl px-3 py-2 text-center min-w-[52px] cursor-pointer transition-all duration-200
                  ${isSelected
                    ? "bg-emerald-500 text-white"
                    : isToday
                      ? "bg-slate-700 ring-1 ring-emerald-500/50"
                      : "bg-slate-800 hover:bg-slate-700"
                  }
                `}
              >
                <div className={`text-xs ${isSelected ? "text-emerald-100" : "text-slate-500"}`}>
                  {dayName}
                </div>
                <div className="text-sm font-semibold">{day}</div>
              </button>
            );
          })}
        </div>

        {mealsLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl bg-slate-800" />
            ))}
          </div>
        ) : selectedDate ? (
          /* Selected day detail */
          selectedMeals.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarDays className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-slate-400 font-medium">No meals logged</p>
              <p className="text-xs text-slate-600 mt-1">Start logging to see your history</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Day summary card */}
              {(() => {
                const dayData = dateMap[selectedDate];
                if (!dayData) return null;
                const proteinPct = Math.min(100, (dayData.protein / proteinGoal) * 100);
                const carbsPct = Math.min(100, (dayData.carbs / carbsGoal) * 100);
                const fatPct = Math.min(100, (dayData.fat / fatGoal) * 100);
                return (
                  <div className={`rounded-2xl bg-slate-900 border p-5 transition-all duration-200 ${adherenceBorder(dayData.calories)}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-200">{formatDate(selectedDate)}</p>
                      {weightMap[selectedDate] && (
                        <p className="text-xs text-slate-500">{kgToLbs(weightMap[selectedDate])} lbs</p>
                      )}
                    </div>
                    <div className="mt-1">
                      <span className="text-2xl font-bold text-emerald-400">{Math.round(dayData.calories)}</span>
                      <span className="text-sm text-slate-500 ml-1">kcal</span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-xs text-slate-400">{fmt1(dayData.protein)}g</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-xs text-slate-400">{fmt1(dayData.carbs)}g</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full bg-rose-400" />
                        <span className="text-xs text-slate-400">{fmt1(dayData.fat)}g</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">{dayData.meals.length} meal{dayData.meals.length !== 1 ? "s" : ""} logged</p>
                    <div className="mt-3 space-y-1">
                      <div className="h-1 rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-blue-400 transition-all duration-500" style={{ width: `${proteinPct}%` }} />
                      </div>
                      <div className="h-1 rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${carbsPct}%` }} />
                      </div>
                      <div className="h-1 rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-rose-400 transition-all duration-500" style={{ width: `${fatPct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Individual meal cards */}
              {selectedMeals.map((meal: any) => (
                <div key={meal.id} className="rounded-2xl bg-slate-900 border border-slate-800/60 overflow-hidden" data-testid={`history-meal-${meal.id}`}>
                  {/* Meal header row */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        onClick={() => setExpandedMeal(expandedMeal === meal.id ? null : meal.id)}
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        data-testid={`button-expand-meal-${meal.id}`}
                      >
                        {expandedMeal === meal.id
                          ? <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <p className="font-medium capitalize text-sm text-slate-200">{meal.mealType}</p>
                      <p className="text-xs text-slate-500 hidden sm:block">
                        P:{fmt1(meal.totalProtein)}g · C:{fmt1(meal.totalCarbs)}g · F:{fmt1(meal.totalFat)}g
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-semibold text-emerald-400">{Math.round(meal.totalCalories ?? 0)}</span>
                      <span className="text-xs text-slate-500">kcal</span>
                      <button
                        onClick={() => deleteMeal(meal.id, `${meal.mealType} on ${formatDate(selectedDate)}`)}
                        className="text-slate-600 hover:text-rose-400 transition-colors p-1"
                        title="Delete entire meal"
                        data-testid={`button-delete-meal-${meal.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded items list */}
                  {expandedMeal === meal.id && (
                    <div className="border-t border-slate-800/60">
                      {(!meal.items || meal.items.length === 0) ? (
                        <p className="px-4 py-3 text-xs text-slate-600">No items recorded</p>
                      ) : (
                        meal.items.map((item: any) => (
                          <div key={item.id} className="flex items-center justify-between px-4 py-2.5 border-t border-slate-800/40 first:border-t-0" data-testid={`history-item-${item.id}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-300 truncate">{item.customName ?? item.name ?? "Custom item"}</p>
                              <p className="text-xs text-slate-500">
                                {Math.round(item.calories ?? 0)} kcal
                                {item.proteinG != null && ` · P:${fmt1(item.proteinG)}g`}
                              </p>
                            </div>
                            <button
                              onClick={() => deleteMealItem(item.id)}
                              className="text-slate-600 hover:text-rose-400 transition-colors p-1 ml-2 flex-shrink-0"
                              title="Remove this item"
                              data-testid={`button-delete-item-${item.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          /* No date selected — show overview cards for days with data */
          (() => {
            const daysWithData = dateChips
              .filter((c) => dateMap[c.dateStr])
              .reverse();

            if (daysWithData.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CalendarDays className="w-10 h-10 text-slate-700 mb-3" />
                  <p className="text-slate-400 font-medium">No meals logged</p>
                  <p className="text-xs text-slate-600 mt-1">Start logging to see your history</p>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {daysWithData.map(({ dateStr }) => {
                  const dayData = dateMap[dateStr];
                  const proteinPct = Math.min(100, (dayData.protein / proteinGoal) * 100);
                  const carbsPct = Math.min(100, (dayData.carbs / carbsGoal) * 100);
                  const fatPct = Math.min(100, (dayData.fat / fatGoal) * 100);
                  return (
                    <button
                      key={dateStr}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`w-full text-left rounded-2xl bg-slate-900 border p-5 transition-all duration-200 hover:bg-slate-800/80 ${adherenceBorder(dayData.calories)}`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-200">{formatDate(dateStr)}</p>
                        <p className="text-xs text-slate-500">{dayData.meals.length} meal{dayData.meals.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="mt-1">
                        <span className="text-2xl font-bold text-emerald-400">{Math.round(dayData.calories)}</span>
                        <span className="text-sm text-slate-500 ml-1">kcal</span>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-blue-400" />
                          <span className="text-xs text-slate-400">{fmt1(dayData.protein)}g</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-amber-400" />
                          <span className="text-xs text-slate-400">{fmt1(dayData.carbs)}g</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-rose-400" />
                          <span className="text-xs text-slate-400">{fmt1(dayData.fat)}g</span>
                        </div>
                      </div>
                      <div className="mt-3 space-y-1">
                        <div className="h-1 rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-blue-400 transition-all duration-500" style={{ width: `${proteinPct}%` }} />
                        </div>
                        <div className="h-1 rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${carbsPct}%` }} />
                        </div>
                        <div className="h-1 rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-rose-400 transition-all duration-500" style={{ width: `${fatPct}%` }} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
