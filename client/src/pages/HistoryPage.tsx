import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmt1, formatDate, kgToLbs } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Trash2, ChevronDown, ChevronUp } from "lucide-react";

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
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null);
  const { toast } = useToast();

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

  // Build date → { calories, meals } map
  const dateMap: Record<string, { calories: number; meals: any[] }> = {};
  for (const meal of mealsRange) {
    if (!dateMap[meal.date]) dateMap[meal.date] = { calories: 0, meals: [] };
    dateMap[meal.date].calories += meal.totalCalories ?? 0;
    dateMap[meal.date].meals.push(meal);
  }

  const weightMap: Record<string, number> = {};
  for (const w of weightLogs) weightMap[w.date] = w.weightKg;

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

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">History</h1>

      {/* Calendar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-secondary" data-testid="button-prev-month">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="font-semibold text-sm">{monthName} {viewYear}</p>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-secondary" data-testid="button-next-month">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-2">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
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
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{formatDate(selectedDate)}</h2>
            {dateMap[selectedDate] && (
              <span className="text-sm text-muted-foreground">
                {Math.round(dateMap[selectedDate].calories)} kcal total
              </span>
            )}
          </div>

          {weightMap[selectedDate] && (
            <p className="text-sm text-muted-foreground">
              Weight: <span className="text-foreground font-medium">{kgToLbs(weightMap[selectedDate])} lbs</span>
            </p>
          )}

          {selectedMeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meals logged on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedMeals.map((meal: any) => (
                <div key={meal.id} className="border border-border rounded-lg overflow-hidden" data-testid={`history-meal-${meal.id}`}>
                  {/* Meal header row */}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-secondary">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Expand/collapse toggle */}
                      <button
                        onClick={() => setExpandedMeal(expandedMeal === meal.id ? null : meal.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        data-testid={`button-expand-meal-${meal.id}`}
                      >
                        {expandedMeal === meal.id
                          ? <ChevronUp className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <p className="font-medium capitalize text-sm">{meal.mealType}</p>
                      <p className="text-xs text-muted-foreground hidden sm:block">
                        P:{fmt1(meal.totalProtein)}g · C:{fmt1(meal.totalCarbs)}g · F:{fmt1(meal.totalFat)}g
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-semibold">{Math.round(meal.totalCalories ?? 0)} kcal</span>
                      {/* Delete entire meal */}
                      <button
                        onClick={() => deleteMeal(meal.id, `${meal.mealType} on ${formatDate(selectedDate)}`)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        title="Delete entire meal"
                        data-testid={`button-delete-meal-${meal.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded items list */}
                  {expandedMeal === meal.id && (
                    <div className="divide-y divide-border">
                      {(!meal.items || meal.items.length === 0) ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">No items recorded</p>
                      ) : (
                        meal.items.map((item: any) => (
                          <div key={item.id} className="flex items-center justify-between px-3 py-2" data-testid={`history-item-${item.id}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{item.customName ?? item.name ?? "Custom item"}</p>
                              <p className="text-xs text-muted-foreground">
                                {Math.round(item.calories ?? 0)} kcal
                                {item.proteinG != null && ` · P:${fmt1(item.proteinG)}g`}
                              </p>
                            </div>
                            <button
                              onClick={() => deleteMealItem(item.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors p-1 ml-2 flex-shrink-0"
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
          )}
        </div>
      )}
    </div>
  );
}
