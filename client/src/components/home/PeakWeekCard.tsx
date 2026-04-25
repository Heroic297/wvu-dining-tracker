import { Trophy, Droplets, Flame } from "lucide-react";

interface PeakWeekDay {
  phase: string;
  label: string;
  focus: string;
  daysOut: number;
  isKeyDay?: boolean;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg: number;
  waterL: string;
  guidance?: string[];
  foods?: string[];
  avoid?: string[];
}

export default function PeakWeekCard({ day }: { day: PeakWeekDay }) {
  return (
    <div className={`surface-card p-4 space-y-3 ${day.isKeyDay ? "surface-card-accent" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Peak Week · Today</span>
        </div>
        <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full">
          {day.daysOut === 0 ? "Meet day" : `${day.daysOut} days out`}
        </span>
      </div>

      <div>
        <p className="text-lg font-bold leading-tight text-slate-100">{day.phase}</p>
        <p className="text-xs text-slate-500 mt-0.5">{day.label}</p>
      </div>

      <div className="bg-slate-800/60 rounded-xl px-3 py-2">
        <p className="text-sm text-slate-200">{day.focus}</p>
      </div>

      <div className="space-y-2">
        <div className="bg-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">Calories</span>
          <span className="text-base font-bold text-emerald-400">
            {day.calories.toLocaleString()} <span className="text-xs font-normal text-slate-500">kcal</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Protein", value: day.proteinG,                       unit: "g",    color: "#60a5fa" },
            { label: "Carbs",   value: day.carbsG,                         unit: "g",    color: "#fbbf24" },
            { label: "Fat",     value: day.fatG,                           unit: "g",    color: "#fb7185" },
            { label: "Sodium",  value: +(day.sodiumMg / 1000).toFixed(1),  unit: "g Na", color: "#60a5fa" },
          ].map(({ label, value, unit, color }) => (
            <div key={label} className="bg-slate-800 rounded-xl px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">{label}</span>
              <span className="text-sm font-bold" style={{ color }}>
                {value}<span className="text-[11px] font-normal text-slate-500 ml-0.5">{unit}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl px-3 py-2.5">
        <Droplets className="w-4 h-4 text-sky-400 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-sky-400">Water today: {day.waterL}</p>
          <p className="text-xs text-slate-500">Stay consistent throughout the day</p>
        </div>
      </div>

      {day.guidance && day.guidance.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3 h-3 text-slate-500" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Today's focus</span>
          </div>
          {day.guidance.map((g, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
              <span className="text-emerald-400 mt-0.5 flex-shrink-0">•</span>
              <span>{g}</span>
            </div>
          ))}
        </div>
      )}

      {(day.foods && day.foods.length > 0 || day.avoid && day.avoid.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {day.foods && day.foods.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-emerald-400 mb-1">Eat</p>
              {day.foods.map((f, i) => <div key={i} className="text-xs text-slate-500">• {f}</div>)}
            </div>
          )}
          {day.avoid && day.avoid.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-rose-400 mb-1">Avoid</p>
              {day.avoid.map((f, i) => <div key={i} className="text-xs text-slate-500">• {f}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
