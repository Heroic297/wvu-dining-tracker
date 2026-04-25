import { Link } from "wouter";
import { Dumbbell, Check } from "lucide-react";

interface TrainingToday {
  programName: string;
  weekNumber: number;
  dayLabel: string;
  exerciseCount: number;
  alreadyLogged: boolean;
}

export default function TrainingTodayRow({ training }: { training: TrainingToday }) {
  return (
    <Link href="/training?tab=today">
      <div className="surface-card px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-400/10 flex-shrink-0">
            <Dumbbell className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500 truncate">
              Week {training.weekNumber} · {training.dayLabel}
            </p>
            <p className="text-sm font-semibold text-slate-100 truncate">
              {training.exerciseCount} exercise{training.exerciseCount !== 1 ? "s" : ""}
              <span className="text-xs font-normal text-slate-500 ml-1.5">{training.programName}</span>
            </p>
          </div>
        </div>
        {training.alreadyLogged ? (
          <span className="flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0 font-medium">
            <Check className="w-3.5 h-3.5" /> Done
          </span>
        ) : (
          <span className="text-xs text-slate-400 flex-shrink-0">Log →</span>
        )}
      </div>
    </Link>
  );
}
