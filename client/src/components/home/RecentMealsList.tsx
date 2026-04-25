import { Link, useLocation } from "wouter";
import { UtensilsCrossed } from "lucide-react";
import EmptyState from "@/components/EmptyState";

interface Meal {
  id: number | string;
  mealType: string;
  items?: unknown[];
  totalCalories?: number;
}

export default function RecentMealsList({ meals }: { meals: Meal[] }) {
  const [, navigate] = useLocation();
  const shown = meals.slice(0, 3);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Recent Meals</p>
        {meals.length > 0 && (
          <Link href="/nutrition?tab=history" className="text-xs text-slate-500 hover:text-slate-300 transition-fast">
            See all →
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="No meals logged yet"
          body="Log your first meal to start tracking."
          action={{ label: "Log meal", onClick: () => navigate("/nutrition?tab=log") }}
        />
      ) : (
        <div className="space-y-2">
          {shown.map((meal) => (
            <div
              key={meal.id}
              className="surface-card px-4 py-3 flex items-center justify-between"
              data-testid={`meal-card-${meal.id}`}
            >
              <div>
                <p className="text-sm font-semibold text-slate-100 capitalize">{meal.mealType}</p>
                <p className="text-xs text-slate-400">{meal.items?.length ?? 0} items</p>
              </div>
              <p className="text-emerald-400 font-bold text-sm">
                {Math.round(meal.totalCalories ?? 0)}{" "}
                <span className="text-slate-500 font-normal">kcal</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
