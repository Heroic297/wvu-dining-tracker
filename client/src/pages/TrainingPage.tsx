import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dumbbell,
  Plus,
  Upload,
  FileText,
  Sparkles,
  Check,
  Trash2,
  Loader2,
  ChevronRight,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWeekNumber(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(0, diffWeeks);
}

function getDayOfWeek(): number {
  return new Date().getDay();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Import Modal ────────────────────────────────────────────────────────────

function ImportProgramModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [importTab, setImportTab] = useState("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [pasteContent, setPasteContent] = useState("");
  const [useAI, setUseAI] = useState(false);
  const [goal, setGoal] = useState("strength");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [experience, setExperience] = useState("intermediate");
  const [equipment, setEquipment] = useState("");

  const importMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/programs/import", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
      onOpenChange(false);
      setSelectedFile(null);
      setSheetNames([]);
      setPasteContent("");
      setUseAI(false);
    },
  });

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSelectedFile(file);
      setSheetNames([]);

      if (/\.(xlsx|xls)$/i.test(file.name)) {
        try {
          const XLSX = await import("xlsx");
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: "array" });
          setSheetNames(wb.SheetNames);
        } catch {
          // preview failed — server will still parse it
        }
      }
    },
    [],
  );

  const handleFileSubmit = useCallback(() => {
    if (!selectedFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      importMutation.mutate({
        type: "paste",
        file: base64,
        fileName: selectedFile.name,
      });
    };
    reader.readAsDataURL(selectedFile);
  }, [selectedFile, importMutation]);

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) return;
    importMutation.mutate({ type: "paste", content: pasteContent.trim() });
  };

  const handleGenerateSubmit = () => {
    importMutation.mutate({
      type: "generate",
      generateParams: {
        goal,
        daysPerWeek,
        experienceLevel: experience,
        equipment: equipment.trim() || undefined,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border text-slate-100 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Import Program
          </DialogTitle>
        </DialogHeader>

        <Tabs value={importTab} onValueChange={setImportTab}>
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1 text-xs">
              Upload File
            </TabsTrigger>
            <TabsTrigger value="paste" className="flex-1 text-xs">
              Paste / Generate
            </TabsTrigger>
          </TabsList>

          {/* Upload File tab */}
          <TabsContent value="file" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Upload PDF, DOCX, Excel, or CSV</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf,.docx,.xlsx,.xls,.csv"
                onChange={handleFileSelect}
                disabled={importMutation.isPending}
                className="bg-slate-900 border-slate-700 file:text-slate-300 file:bg-slate-800 file:border-0 file:rounded file:px-3 file:py-1 file:mr-3"
              />
              <p className="text-xs text-slate-500 leading-relaxed">
                Spreadsheets: name each tab "Week 1", "Week 2"… or "Push Day",
                "Legs", etc. Column A = exercise name; B–D = sets, reps, weight.
              </p>
            </div>

            {sheetNames.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-400">Detected sheets:</p>
                <div className="flex flex-wrap gap-1.5">
                  {sheetNames.map((name) => (
                    <span
                      key={name}
                      className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {importMutation.isPending && importTab === "file" && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing file...
              </div>
            )}

            <Button
              onClick={handleFileSubmit}
              disabled={importMutation.isPending || !selectedFile}
              className="w-full"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Import File
            </Button>
          </TabsContent>

          {/* Paste / Generate tab */}
          <TabsContent value="paste" className="space-y-4 mt-4">
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => setUseAI(false)}
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  !useAI
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <FileText className="h-3.5 w-3.5 inline mr-1" />
                Paste Text
              </button>
              <button
                onClick={() => setUseAI(true)}
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  useAI
                    ? "bg-purple-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 inline mr-1" />
                Generate with AI
              </button>
            </div>

            {!useAI ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="paste-content">Paste your program text</Label>
                  <Textarea
                    id="paste-content"
                    placeholder="Paste your training program here..."
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    rows={8}
                    className="bg-slate-900 border-slate-700"
                  />
                </div>
                <Button
                  onClick={handlePasteSubmit}
                  disabled={importMutation.isPending || !pasteContent.trim()}
                  className="w-full"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Import Program
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Goal</Label>
                  <Select value={goal} onValueChange={setGoal}>
                    <SelectTrigger className="bg-slate-900 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strength">Strength</SelectItem>
                      <SelectItem value="hypertrophy">Hypertrophy</SelectItem>
                      <SelectItem value="powerlifting">Powerlifting</SelectItem>
                      <SelectItem value="conditioning">Conditioning</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="days-per-week">Days per Week</Label>
                  <Input
                    id="days-per-week"
                    type="number"
                    min={1}
                    max={7}
                    value={daysPerWeek}
                    onChange={(e) =>
                      setDaysPerWeek(
                        Math.min(7, Math.max(1, parseInt(e.target.value) || 1)),
                      )
                    }
                    className="bg-slate-900 border-slate-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Experience Level</Label>
                  <Select value={experience} onValueChange={setExperience}>
                    <SelectTrigger className="bg-slate-900 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="equipment">Available Equipment (optional)</Label>
                  <Input
                    id="equipment"
                    placeholder="e.g. barbell, dumbbells, pull-up bar..."
                    value={equipment}
                    onChange={(e) => setEquipment(e.target.value)}
                    className="bg-slate-900 border-slate-700"
                  />
                </div>

                <Button
                  onClick={handleGenerateSubmit}
                  disabled={importMutation.isPending}
                  className="w-full bg-purple-600 hover:bg-purple-700"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Generate Program
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Programs Tab ────────────────────────────────────────────────────────────

function ProgramsTab() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const { data: programs = [], isLoading } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/programs");
      return res.json();
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/programs/${id}`, {
        is_active: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/programs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/programs"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">
          Your Programs
        </h2>
        <Button
          onClick={() => setImportOpen(true)}
          size="sm"
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Import Program
        </Button>
      </div>

      {programs.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Dumbbell className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No programs yet. Import one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map((program) => (
            <div
              key={program.id}
              className="bg-card border border-border rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-slate-100">
                      {program.name}
                    </h3>
                    {program.isActive && (
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-600/20 text-emerald-400 px-2 py-0.5 rounded-full">
                        <Check className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                    {program.source}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!program.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => activateMutation.mutate(program.id)}
                    disabled={activateMutation.isPending}
                    className="text-xs"
                  >
                    {activateMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Check className="h-3 w-3 mr-1" />
                    )}
                    Set Active
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(program.id)}
                  disabled={deleteMutation.isPending}
                  className="text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ImportProgramModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

// ── Today Tab ───────────────────────────────────────────────────────────────

function TodayTab() {
  const queryClient = useQueryClient();

  const { data: programs = [] } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/programs");
      return res.json();
    },
  });

  const activeProgram = programs.find((p) => p.isActive);

  const weekNumber = activeProgram
    ? getWeekNumber(activeProgram.createdAt)
    : 0;
  const dayIndex = getDayOfWeek();

  const currentDay: DayBlock | null = (() => {
    if (!activeProgram?.parsedBlocks?.weeks) return null;
    const week = activeProgram.parsedBlocks.weeks.find(
      (w) => w.weekNumber === weekNumber,
    );
    if (!week?.days?.[dayIndex]) return null;
    return week.days[dayIndex];
  })();

  const [manualDay, setManualDay] = useState<DayBlock | null>(null);
  const [manualWeekNumber, setManualWeekNumber] = useState<number>(0);

  const activeDay = currentDay ?? manualDay;
  const activeWeekNumber = currentDay ? weekNumber : manualWeekNumber;

  const allProgramDays = activeProgram?.parsedBlocks?.weeks?.flatMap((week) =>
    week.days.map((day) => ({ day, weekNumber: week.weekNumber })),
  ) ?? [];

  // Build initial exercise log state from the active day's exercises
  const buildInitialLogs = useCallback((): ExerciseLog[] => {
    if (!activeDay) return [];
    return activeDay.exercises.map((ex) => ({
      name: ex.name,
      sets: Array.from({ length: ex.sets }, () => ({
        reps: parseInt(ex.reps) || 0,
        weight: parseFloat(ex.weight || "0") || 0,
        rpe: 0,
        completed: false,
      })),
    }));
  }, [activeDay]);

  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setExerciseLogs(buildInitialLogs());
  }, [buildInitialLogs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workout-logs", {
        programId: activeProgram!.id,
        date: todayStr(),
        weekNumber: activeWeekNumber,
        dayLabel: activeDay?.label ?? `Day ${dayIndex + 1}`,
        exercises: exerciseLogs,
        notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/workout-logs"],
      });
    },
  });

  const updateSet = (
    exIdx: number,
    setIdx: number,
    field: keyof SetLog,
    value: number | boolean,
  ) => {
    setExerciseLogs((prev) => {
      const next = prev.map((ex, ei) => {
        if (ei !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, si) => {
            if (si !== setIdx) return s;
            return { ...s, [field]: value };
          }),
        };
      });
      return next;
    });
  };

  if (!activeProgram) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Dumbbell className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">
          No active program. Go to the Programs tab and set one as active.
        </p>
      </div>
    );
  }

  if (!activeDay) {
    return (
      <div className="space-y-4 py-4">
        <div className="text-center text-slate-400">
          <Dumbbell className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No workout scheduled for today. Pick a day to log:</p>
        </div>
        <div className="space-y-2">
          {allProgramDays.map(({ day, weekNumber: wn }, i) => (
            <button
              key={i}
              onClick={() => { setManualDay(day); setManualWeekNumber(wn); }}
              className="w-full text-left bg-card border border-border rounded-xl p-3 hover:bg-slate-800/50 transition-colors"
            >
              <span className="text-sm font-medium text-slate-200">{day.label}</span>
              <span className="text-xs text-slate-500 ml-2">Week {wn}</span>
              <span className="text-xs text-slate-600 ml-2">
                {day.exercises.length} exercise{day.exercises.length !== 1 ? "s" : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            {activeDay.label}
          </h2>
          <p className="text-xs text-slate-500">
            Week {activeWeekNumber + 1} &middot; {activeProgram.name}
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="sm"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Check className="h-4 w-4 mr-1.5" />
          )}
          Save Workout
        </Button>
      </div>

      {saveMutation.isSuccess && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg px-3 py-2 text-sm text-emerald-300">
          Workout saved successfully!
        </div>
      )}

      <div className="space-y-4">
        {exerciseLogs.map((exercise, exIdx) => (
          <div
            key={exIdx}
            className="bg-card border border-border rounded-xl p-4 space-y-3"
          >
            <h3 className="font-medium text-slate-100 flex items-center gap-2">
              <Dumbbell className="h-4 w-4 text-slate-400" />
              {exercise.name}
            </h3>

            <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 text-xs text-slate-500 px-1">
              <span>Set</span>
              <span>Reps</span>
              <span>Weight</span>
              <span>RPE</span>
              <span></span>
            </div>

            {exercise.sets.map((set, setIdx) => (
              <div
                key={setIdx}
                className={`grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center px-1 ${
                  set.completed ? "opacity-60" : ""
                }`}
              >
                <span className="text-xs text-slate-500 w-6 text-center">
                  {setIdx + 1}
                </span>
                <Input
                  type="number"
                  value={set.reps || ""}
                  onChange={(e) =>
                    updateSet(exIdx, setIdx, "reps", parseInt(e.target.value) || 0)
                  }
                  placeholder="Reps"
                  className="h-8 text-sm bg-slate-900 border-slate-700"
                />
                <Input
                  type="number"
                  value={set.weight || ""}
                  onChange={(e) =>
                    updateSet(
                      exIdx,
                      setIdx,
                      "weight",
                      parseFloat(e.target.value) || 0,
                    )
                  }
                  placeholder="lbs"
                  className="h-8 text-sm bg-slate-900 border-slate-700"
                />
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={set.rpe || ""}
                  onChange={(e) =>
                    updateSet(
                      exIdx,
                      setIdx,
                      "rpe",
                      Math.min(10, Math.max(1, parseInt(e.target.value) || 0)),
                    )
                  }
                  placeholder="RPE"
                  className="h-8 text-sm bg-slate-900 border-slate-700"
                />
                <Button
                  variant={set.completed ? "default" : "outline"}
                  size="sm"
                  className={`h-8 w-8 p-0 ${
                    set.completed
                      ? "bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
                      : ""
                  }`}
                  onClick={() =>
                    updateSet(exIdx, setIdx, "completed", !set.completed)
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="workout-notes">Notes</Label>
        <Textarea
          id="workout-notes"
          placeholder="How did the workout feel?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="bg-slate-900 border-slate-700"
        />
      </div>
    </div>
  );
}

// ── History Tab ─────────────────────────────────────────────────────────────

function HistoryTab() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: history = [], isLoading } = useQuery<WorkoutLog[]>({
    queryKey: ["/api/workout-logs/history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-logs/history");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No workout history yet. Complete a workout to see it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-100">Workout History</h2>

      {history.map((log) => {
        const isExpanded = expandedId === log.id;
        return (
          <div
            key={log.id}
            className="bg-card border border-border rounded-xl overflow-hidden"
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : log.id)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/50 transition-colors"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-100">
                    {log.dayLabel}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(log.date + "T00:00:00").toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {log.exercises.length} exercise
                  {log.exercises.length !== 1 ? "s" : ""}
                  {log.notes ? ` \u00B7 ${log.notes.slice(0, 50)}${log.notes.length > 50 ? "..." : ""}` : ""}
                </p>
              </div>
              <ChevronRight
                className={`h-4 w-4 text-slate-500 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                {log.exercises.map((ex, i) => (
                  <div key={i} className="space-y-1">
                    <h4 className="text-sm font-medium text-slate-200">
                      {ex.name}
                    </h4>
                    <div className="space-y-0.5">
                      {ex.sets.map((set, si) => (
                        <div
                          key={si}
                          className="text-xs text-slate-400 flex gap-3"
                        >
                          <span className="text-slate-500">
                            Set {si + 1}:
                          </span>
                          <span>{set.reps} reps</span>
                          <span>{set.weight} lbs</span>
                          {set.rpe > 0 && <span>RPE {set.rpe}</span>}
                          {set.completed && (
                            <Check className="h-3 w-3 text-emerald-400 inline" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {log.notes && (
                  <p className="text-xs text-slate-400 italic pt-1">
                    {log.notes}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function TrainingPage() {
  const [tab, setTab] = useState("programs");

  return (
    <div className="min-h-screen text-slate-100 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4 fade-up">
        <div className="flex items-center gap-3">
          <Dumbbell className="h-7 w-7 text-emerald-400" style={{ filter: "drop-shadow(0 0 8px hsl(158 64% 42% / 0.5))" }} />
          <h1
            className="text-3xl font-extrabold gradient-text"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Training
          </h1>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="programs" className="flex-1">
              Programs
            </TabsTrigger>
            <TabsTrigger value="today" className="flex-1">
              Today
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="programs">
            <ProgramsTab />
          </TabsContent>

          <TabsContent value="today">
            <TodayTab />
          </TabsContent>

          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
