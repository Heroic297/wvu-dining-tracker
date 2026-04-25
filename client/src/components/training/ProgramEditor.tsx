import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Exercise {
  name: string;
  sets: number;
  reps: string;
  weight?: string;
  rpe?: string;
  notes?: string;
}

interface DayBlock {
  label: string;
  exercises: Exercise[];
}

interface WeekBlock {
  weekNumber: number;
  days: DayBlock[];
}

interface Program {
  id: string;
  name: string;
  parsedBlocks: { weeks: WeekBlock[] };
}

function emptyExercise(): Exercise {
  return { name: "", sets: 3, reps: "8", weight: "", rpe: "" };
}

export default function ProgramEditor({ program }: { program: Program }) {
  const queryClient = useQueryClient();
  const [weeks, setWeeks] = useState<WeekBlock[]>(() =>
    JSON.parse(JSON.stringify(program.parsedBlocks?.weeks ?? []))
  );
  const [expandedWeek, setExpandedWeek] = useState<number | null>(weeks[0]?.weekNumber ?? null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/programs/${program.id}`, {
        parsedBlocks: { weeks },
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      setDirty(false);
    },
  });

  const mutate = (fn: (draft: WeekBlock[]) => void) => {
    setWeeks(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as WeekBlock[];
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const setExField = (wi: number, di: number, ei: number, field: keyof Exercise, val: string | number) =>
    mutate(w => { (w[wi].days[di].exercises[ei] as any)[field] = val; });

  const addExercise = (wi: number, di: number) =>
    mutate(w => w[wi].days[di].exercises.push(emptyExercise()));

  const removeExercise = (wi: number, di: number, ei: number) =>
    mutate(w => w[wi].days[di].exercises.splice(ei, 1));

  return (
    <div className="space-y-2 mt-3">
      {weeks.map((week, wi) => {
        const wExpanded = expandedWeek === week.weekNumber;
        return (
          <div key={week.weekNumber} className="rounded-xl border border-white/5 overflow-hidden">
            <button
              onClick={() => setExpandedWeek(wExpanded ? null : week.weekNumber)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-left"
            >
              <span className="text-sm font-semibold text-slate-200">Week {week.weekNumber}</span>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{week.days.length} day{week.days.length !== 1 ? "s" : ""}</span>
                {wExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </div>
            </button>

            {wExpanded && (
              <div className="p-3 space-y-2 bg-slate-900/30">
                {week.days.map((day, di) => {
                  const dKey = `${wi}-${di}`;
                  const dExpanded = expandedDay === dKey;
                  return (
                    <div key={di} className="rounded-lg border border-white/5 overflow-hidden">
                      <button
                        onClick={() => setExpandedDay(dExpanded ? null : dKey)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/40 hover:bg-slate-800/40 transition-colors text-left"
                      >
                        <span className="text-xs font-medium text-slate-300">{day.label}</span>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{day.exercises.length} ex</span>
                          {dExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </div>
                      </button>

                      {dExpanded && (
                        <div className="p-3 space-y-2">
                          {/* Column headers */}
                          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-1.5 text-[10px] text-slate-500 px-1">
                            <span>Exercise</span><span>Sets</span><span>Reps</span><span>Wt</span><span></span>
                          </div>

                          {day.exercises.map((ex, ei) => (
                            <div key={ei} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-1.5 items-center">
                              <Input
                                value={ex.name}
                                onChange={e => setExField(wi, di, ei, "name", e.target.value)}
                                placeholder="Exercise"
                                className="h-7 text-xs bg-slate-900 border-slate-700 px-2"
                              />
                              <Input
                                type="number" min={1}
                                value={ex.sets}
                                onChange={e => setExField(wi, di, ei, "sets", parseInt(e.target.value) || 1)}
                                className="h-7 text-xs bg-slate-900 border-slate-700 px-2"
                              />
                              <Input
                                value={ex.reps}
                                onChange={e => setExField(wi, di, ei, "reps", e.target.value)}
                                placeholder="8"
                                className="h-7 text-xs bg-slate-900 border-slate-700 px-2"
                              />
                              <Input
                                value={ex.weight ?? ""}
                                onChange={e => setExField(wi, di, ei, "weight", e.target.value)}
                                placeholder="lb"
                                className="h-7 text-xs bg-slate-900 border-slate-700 px-2"
                              />
                              <button
                                onClick={() => removeExercise(wi, di, ei)}
                                className="text-slate-600 hover:text-rose-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}

                          <button
                            onClick={() => addExercise(wi, di)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-400 transition-colors mt-1"
                          >
                            <Plus className="w-3 h-3" /> Add exercise
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {dirty && (
        <div className="pt-1">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-1.5"
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
