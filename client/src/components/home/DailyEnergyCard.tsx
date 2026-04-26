import ProgressRing from "@/components/ProgressRing";
import { MACRO_COLORS } from "@/lib/tokens";

interface MacroNums {
  protein: number; proteinGoal: number;
  carbs: number;   carbsGoal: number;
  fat: number;     fatGoal: number;
}

interface Props {
  calories: number;
  calorieGoal: number;
  macros: MacroNums;
}

interface MiniRingProps {
  value: number;
  max: number;
  color: string;
  label: string;
  unit?: string;
}

function MiniRing({ value, max, color, label, unit = "g" }: MiniRingProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <ProgressRing value={value} max={max} size={72} strokeWidth={7} color={color}>
        <span className="text-[12px] font-bold text-slate-100 leading-none">{value}</span>
        <span className="text-[9px] text-slate-500 leading-none mt-0.5">/{max}{unit}</span>
      </ProgressRing>
      <p className="text-[11px] font-semibold text-slate-300">{label}</p>
    </div>
  );
}

const calRemainLabel = (cal: number, goal: number) => {
  const r = Math.round(goal - cal);
  return r >= 0 ? `${r} left` : `${Math.abs(r)} over`;
};

export default function DailyEnergyCard({ calories, calorieGoal, macros }: Props) {
  const { protein, proteinGoal, carbs, carbsGoal, fat, fatGoal } = macros;

  return (
    <div className="surface-card p-5 space-y-5"
      style={{ background: "linear-gradient(135deg, hsl(222 20% 10%) 0%, hsl(222 15% 8%) 100%)" }}
    >
      {/* Calorie ring */}
      <div className="flex flex-col items-center">
        <ProgressRing value={Math.round(calories)} max={calorieGoal} size={180} strokeWidth={14} color="#34d399">
          <span className="text-4xl font-bold text-slate-100 leading-none">{Math.round(calories)}</span>
          <span className="text-xs text-slate-500 mt-0.5">kcal</span>
          <span className="text-[11px] text-slate-400 mt-1">{calRemainLabel(calories, calorieGoal)}</span>
        </ProgressRing>
        <p className="text-xs text-slate-500 mt-1">Goal: {calorieGoal} kcal</p>
      </div>

      {/* Macro mini-rings */}
      <div className="flex justify-around">
        <MiniRing value={Math.round(protein)} max={proteinGoal} color={MACRO_COLORS.protein} label="Protein" />
        <MiniRing value={Math.round(carbs)}   max={carbsGoal}   color={MACRO_COLORS.carbs}   label="Carbs"   />
        <MiniRing value={Math.round(fat)}      max={fatGoal}     color={MACRO_COLORS.fat}     label="Fat"     />
      </div>
    </div>
  );
}
