import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Dumbbell,
  Plus,
  FileText,
  Check,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import ProgramImportInput from "@/components/training/ProgramImportInput";
import ProgramEditor from "@/components/training/ProgramEditor";
import EmptyState from "@/components/EmptyState";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface ParsedBlocks {
  weeks: WeekBlock[];
}

interface Program {
  id: string;
  name: string;
  source: string;
  isActive: boolean;
  createdAt: string;
  startDate?: string | null;
  parsedBlocks: ParsedBlocks;
}

interface SetLog {
  reps: number;
  weight: number;
  rpe: number;
  completed: boolean;
}

interface ExerciseLog {
  name: string;
  sets: SetLog[];
}

interface WorkoutLog {
  id: string;
  programId: string;
  date: string;
  weekNumber: number;
  dayLabel: string;
  exercises: ExerciseLog[];
  notes: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNextSequentialDay(
  program: Program,
  lastWeekNumber: number | null,
  lastDayLabel: string | null,
): { day: DayBlock; weekNumber: number } | null {
  const weeks = program.parsedBlocks?.weeks ?? [];
  if (weeks.length === 0) return null;

  if (lastWeekNumber == null || lastDayLabel == null) {
    if (weeks[0].days?.length > 0) return { day: weeks[0].days[0], weekNumber: weeks[0].weekNumber };
    return null;
  }

  for (let wi = 0; wi < weeks.length; wi++) {
    if (weeks[wi].weekNumber !== lastWeekNumber) continue;
    for (let di = 0; di < weeks[wi].days.length; di++) {
      if (weeks[wi].days[di].label !== lastDayLabel) continue;
      if (di + 1 < weeks[wi].days.length) return { day: weeks[wi].days[di + 1], weekNumber: weeks[wi].weekNumber };
      if (wi + 1 < weeks.length && weeks[wi + 1].days?.length > 0)
        return { day: weeks[wi + 1].days[0], weekNumber: weeks[wi + 1].weekNumber };
      return { day: weeks[wi].days[di], weekNumber: weeks[wi].weekNumber };
    }
  }

  if (weeks[0].days?.length > 0) return { day: weeks[0].days[0], weekNumber: weeks[0].weekNumber };
  return null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatLogDate(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return new Date(`${y}-${m}-${d}T12:00:00`).toLocaleDateString();
  }
  if (typeof raw === "string") {
    const s = raw.includes("T") ? raw : raw + "T12:00:00";
    return new Date(s).toLocaleDateString();
  }
  return String(raw);
}

// Reads ?tab= from hash URL like /#/training?tab=today
function getInitialTab(): string {
  if (typeof window === "undefined") return "programs";
  const hash = window.location.hash; // e.g. "#/training?tab=today"
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return "programs";
  const t = new URLSearchParams(hash.slice(qIndex + 1)).get("tab");
  return t === "today" || t === "history" || t === "programs" ? t : "programs";
}

// ── Import Modal ──────────────────────────────────────────────────────────────

function ImportProgramModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/programs/import", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border text-slate-100 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Program
          </DialogTitle>
        </DialogHeader>
        <ProgramImportInput
          isPending={importMutation.isPending}
          onImport={body => importMutation.mutate(body)}
        />
        {importMutation.isError && (
          <p className="text-sm text-red-400">Import failed. Please try again.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Programs Tab ──────────────────────────────────────────────────────────────

function ProgramsTab() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: programs = [], isLoading } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/programs");
      return res.json();
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/programs/${id}`, { is_active: true });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/programs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/programs/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/programs"] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Your Programs</h2>
        <Button onClick={() => setImportOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Program
        </Button>
      </div>

      {programs.length === 0 ? (
        <EmptyState
          icon={Dumbbell}
          title="No programs yet"
          body="Add a program to start logging workouts."
          action={{ label: "Add Program", onClick: () => setImportOpen(true) }}
        />
      ) : (
        <div className="space-y-3">
          {programs.map((program) => {
            const expanded = expandedId === program.id;
            return (
              <div key={program.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-start justify-between p-4 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-slate-100">{program.name}</h3>
                      {program.isActive && (
                        <span className="inline-flex items-center gap-1 text-xs bg-emerald-600/20 text-emerald-400 px-2 py-0.5 rounded-full">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded mt-1 inline-block">{program.source}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!program.isActive && (
                      <Button variant="outline" size="sm" onClick={() => activateMutation.mutate(program.id)} disabled={activateMutation.isPending} className="text-xs">
                        {activateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                        Set Active
                      </Button>
                    )}
                    <button onClick={() => { if (confirm("Delete this program?")) deleteMutation.mutate(program.id); }} className="text-slate-500 hover:text-rose-400 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => setExpandedId(expanded ? null : program.id)} className="text-slate-500 hover:text-slate-200 transition-colors">
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border px-4 pb-4">
                    <ProgramEditor program={program} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ImportProgramModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

// ── Today Tab ─────────────────────────────────────────────────────────────────

function TodayTab() {
  const queryClient = useQueryClient();
  const [showSelector, setShowSelector] = useState(false);

  const { data: programs = [] } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/programs");
      return res.json();
    },
  });

  const { data: history = [] } = useQuery<WorkoutLog[]>({
    queryKey: ["/api/workout-logs/history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-logs/history");
      return res.json();
    },
  });

  const activeProgram = programs.find(p => p.isActive);

  const [manualDay, setManualDay] = useState<DayBlock | null>(null);
  const [manualWeekNumber, setManualWeekNumber] = useState<number>(0);
  const [defaultApplied, setDefaultApplied] = useState(false);

  useEffect(() => {
    if (!activeProgram || defaultApplied) return;
    setDefaultApplied(true);
    const lastLog = history[0] ?? null;
    const result = getNextSequentialDay(activeProgram, lastLog?.weekNumber ?? null, lastLog?.dayLabel ?? null);
    if (result) {
      setManualDay(result.day);
      setManualWeekNumber(result.weekNumber);
    }
  }, [activeProgram, history, defaultApplied]);

  const buildInitialLogs = useCallback((): ExerciseLog[] => {
    if (!manualDay) return [];
    return manualDay.exercises.map(ex => ({
      name: ex.name,
      sets: Array.from({ length: ex.sets }, () => ({
        reps: parseInt(ex.reps) || 0,
        weight: 0,
        rpe: 0,
        completed: false,
      })),
    }));
  }, [manualDay]);

  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setExerciseLogs(buildInitialLogs());
    setNotes("");
  }, [buildInitialLogs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workout-logs", {
        programId: activeProgram!.id,
        date: todayStr(),
        weekNumber: manualWeekNumber,
        dayLabel: manualDay?.label ?? "Unknown Day",
        exercises: exerciseLogs,
        notes,
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/workout-logs"] }),
  });

  const updateSet = (exIdx: number, setIdx: number, field: keyof SetLog, value: number | boolean) => {
    setExerciseLogs(prev =>
      prev.map((ex, ei) => {
        if (ei !== exIdx) return ex;
        return { ...ex, sets: ex.sets.map((s, si) => si !== setIdx ? s : { ...s, [field]: value }) };
      })
    );
  };

  if (!activeProgram) {
    return (
      <EmptyState
        icon={Dumbbell}
        title="No active program"
        body="Go to the Programs tab and set one as active."
      />
    );
  }

  const weeks = activeProgram.parsedBlocks?.weeks ?? [];
  const selectedWeekDays = weeks.find(w => w.weekNumber === manualWeekNumber)?.days ?? [];

  return (
    <div className="space-y-4">
      {/* Next workout hero header */}
      {manualDay ? (
        <div className="surface-card p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Next Workout</p>
              <h2 className="text-xl font-bold text-slate-100">{manualDay.label}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Week {manualWeekNumber} · {activeProgram.name} · {manualDay.exercises.length} exercise{manualDay.exercises.length !== 1 ? "s" : ""}
              </p>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
              Save
            </Button>
          </div>

          {/* Change workout disclosure */}
          <button
            onClick={() => setShowSelector(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors mt-3"
          >
            {showSelector ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Change workout
          </button>

          {showSelector && (
            <div className="mt-3 space-y-3 pt-3 border-t border-white/5">
              <div className="space-y-1.5">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Week</p>
                <div className="flex flex-wrap gap-1.5">
                  {weeks.map(week => (
                    <button
                      key={week.weekNumber}
                      onClick={() => {
                        setManualWeekNumber(week.weekNumber);
                        if (week.days.length > 0) setManualDay(week.days[0]);
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        manualWeekNumber === week.weekNumber
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      W{week.weekNumber}
                    </button>
                  ))}
                </div>
              </div>
              {selectedWeekDays.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Day</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedWeekDays.map((day, i) => (
                      <button
                        key={i}
                        onClick={() => setManualDay(day)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          manualDay?.label === day.label
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {saveMutation.isSuccess && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg px-3 py-2 text-sm text-emerald-300">
          Workout saved successfully!
        </div>
      )}

      {manualDay && (
        <>
          <div className="space-y-4">
            {exerciseLogs.map((exercise, exIdx) => {
              const programmedWeight = manualDay.exercises[exIdx]?.weight;
              return (
                <div key={exIdx} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-slate-100 flex items-center gap-2">
                      <Dumbbell className="h-4 w-4 text-slate-400" />
                      {exercise.name}
                    </h3>
                    {programmedWeight && (
                      <span className="text-xs text-slate-500">Target: {programmedWeight} lb</span>
                    )}
                  </div>

                  <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 text-xs text-slate-500 px-1">
                    <span>Set</span><span>Reps</span><span>Weight</span><span>RPE</span><span></span>
                  </div>

                  {exercise.sets.map((set, setIdx) => (
                    <div key={setIdx} className={`grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center px-1 ${set.completed ? "opacity-60" : ""}`}>
                      <span className="text-xs text-slate-500 w-6 text-center">{setIdx + 1}</span>
                      <input
                        type="number"
                        value={set.reps || ""}
                        onChange={e => updateSet(exIdx, setIdx, "reps", parseInt(e.target.value) || 0)}
                        placeholder="Reps"
                        className="h-8 text-sm bg-slate-900 border border-slate-700 rounded px-2 text-slate-100 w-full"
                      />
                      <input
                        type="number"
                        value={set.weight || ""}
                        onChange={e => updateSet(exIdx, setIdx, "weight", parseFloat(e.target.value) || 0)}
                        placeholder={programmedWeight || "lbs"}
                        className="h-8 text-sm bg-slate-900 border border-slate-700 rounded px-2 text-slate-100 w-full"
                      />
                      <input
                        type="number"
                        min={1} max={10}
                        value={set.rpe || ""}
                        onChange={e => updateSet(exIdx, setIdx, "rpe", Math.min(10, Math.max(1, parseInt(e.target.value) || 0)))}
                        placeholder="RPE"
                        className="h-8 text-sm bg-slate-900 border border-slate-700 rounded px-2 text-slate-100 w-full"
                      />
                      <Button
                        variant={set.completed ? "default" : "outline"}
                        size="sm"
                        className={`h-8 w-8 p-0 ${set.completed ? "bg-emerald-600 hover:bg-emerald-700 border-emerald-600" : ""}`}
                        onClick={() => updateSet(exIdx, setIdx, "completed", !set.completed)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="workout-notes">Notes</Label>
            <Textarea
              id="workout-notes"
              placeholder="How did the workout feel?"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="bg-slate-900 border-slate-700"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery<WorkoutLog[]>({
    queryKey: ["/api/workout-logs/history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-logs/history");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/workout-logs/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-logs/history"] });
      setExpandedId(null);
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }

  if (history.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No workout history yet"
        body="Complete a workout to see it here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-100">Workout History</h2>
      {history.map(log => {
        const isExpanded = expandedId === log.id;
        return (
          <div key={log.id} className="bg-card border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setExpandedId(isExpanded ? null : log.id)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/50 transition-colors"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-100">{log.dayLabel}</span>
                  <span className="text-xs text-slate-500">{formatLogDate(log.date)}</span>
                </div>
                <p className="text-xs text-slate-400">
                  {log.exercises.length} exercise{log.exercises.length !== 1 ? "s" : ""}
                  {log.notes ? ` · ${log.notes.slice(0, 50)}${log.notes.length > 50 ? "..." : ""}` : ""}
                </p>
              </div>
              <ChevronRight className={`h-4 w-4 text-slate-500 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                {log.exercises.map((ex, i) => (
                  <div key={i} className="space-y-1">
                    <h4 className="text-sm font-medium text-slate-200">{ex.name}</h4>
                    <div className="space-y-0.5">
                      {ex.sets.map((set, si) => (
                        <div key={si} className="text-xs text-slate-400 flex gap-3">
                          <span className="text-slate-500">Set {si + 1}:</span>
                          <span>{set.reps} reps</span>
                          <span>{set.weight} lbs</span>
                          {set.rpe > 0 && <span>RPE {set.rpe}</span>}
                          {set.completed && <Check className="h-3 w-3 text-emerald-400 inline" />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {log.notes && <p className="text-xs text-slate-400 italic pt-1">{log.notes}</p>}
                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => { if (confirm("Delete this workout log?")) deleteMutation.mutate(log.id); }}
                    disabled={deleteMutation.isPending}
                    className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete log
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const [tab, setTab] = useState(getInitialTab);

  return (
    <div className="min-h-screen text-slate-100 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4 fade-up">
        <div className="flex items-center gap-3">
          <Dumbbell className="h-7 w-7 text-emerald-400" style={{ filter: "drop-shadow(0 0 8px hsl(158 64% 42% / 0.5))" }} />
          <h1 className="text-3xl font-extrabold gradient-text" style={{ fontFamily: "var(--font-display)" }}>
            Training
          </h1>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="programs" className="flex-1">Programs</TabsTrigger>
            <TabsTrigger value="today" className="flex-1">Today</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
          </TabsList>

          <TabsContent value="programs"><ProgramsTab /></TabsContent>
          <TabsContent value="today"><TodayTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
