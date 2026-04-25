import { useSearch } from "wouter";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import LogMealPage from "@/pages/LogMealPage";
import HistoryPage from "@/pages/HistoryPage";
import DietPlanPage from "@/pages/DietPlanPage";

type NutritionTab = "log" | "history" | "plan";

const TABS: { value: NutritionTab; label: string }[] = [
  { value: "log",     label: "Log Meal" },
  { value: "history", label: "History"  },
  { value: "plan",    label: "Plan"     },
];

function parseTab(search: string): NutritionTab {
  const params = new URLSearchParams(search);
  const t = params.get("tab");
  if (t === "log" || t === "history" || t === "plan") return t;
  return "log";
}

export default function NutritionPage() {
  const search = useSearch();
  const tab = parseTab(search);

  return (
    <>
      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-xl border-b border-white/5 px-4 py-2">
        <div className="flex gap-1 max-w-lg mx-auto bg-slate-900/60 p-1 rounded-xl border border-white/5">
          {TABS.map(({ value, label }) => (
            <Link
              key={value}
              href={`/nutrition?tab=${value}`}
              className={cn(
                "flex-1 text-center text-sm font-medium py-1.5 rounded-lg transition-all duration-150",
                tab === value
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-slate-100"
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {tab === "log"     && <LogMealPage />}
      {tab === "history" && <HistoryPage />}
      {tab === "plan"    && <DietPlanPage />}
    </>
  );
}
