import { useState, useCallback } from "react";
import { Upload, Sparkles, FileText, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  isPending: boolean;
  onImport: (body: Record<string, unknown>) => void;
}

type DetectedMode = "file" | "paste" | "generate";

function detectMode(text: string): DetectedMode {
  if (!text.trim()) return "paste";
  const hasStructure = /week|day|\d+\s*(x|sets?)\s*\d+/i.test(text) || text.includes("\n");
  const isShort = text.trim().length < 400;
  if (!hasStructure && isShort) return "generate";
  return "paste";
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProgramImportInput({ isPending, onImport }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayStr());
  const [showWizard, setShowWizard] = useState(false);

  // Wizard state
  const [goal, setGoal] = useState("strength");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [experience, setExperience] = useState("intermediate");
  const [equipment, setEquipment] = useState("");

  const detectedMode: DetectedMode = file ? "file" : (showWizard ? "generate" : detectMode(text));

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setSheetNames([]);
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      try {
        const XLSX = await import("xlsx");
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        setSheetNames(wb.SheetNames);
      } catch { /* preview failed */ }
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setFile(f);
    setSheetNames([]);
  }, []);

  const handleSubmit = () => {
    if (showWizard) {
      onImport({
        type: "generate",
        startDate: startDate || undefined,
        generateParams: { goal, daysPerWeek, experienceLevel: experience, equipment: equipment.trim() || undefined },
      });
      return;
    }
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        onImport({ type: "paste", file: base64, fileName: file.name, startDate: startDate || undefined });
      };
      reader.readAsDataURL(file);
      return;
    }
    if (text.trim()) {
      const mode = detectMode(text);
      if (mode === "generate") {
        onImport({ type: "generate", startDate: startDate || undefined, generateParams: { seedPrompt: text.trim() } });
      } else {
        onImport({ type: "paste", content: text.trim(), startDate: startDate || undefined });
      }
    }
  };

  const modeLabel: Record<DetectedMode, string> = {
    file: "Import File",
    paste: "Import Program",
    generate: "Generate with AI",
  };

  const isReady = showWizard || file != null || text.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Drop zone + textarea */}
      {!file ? (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className={cn(
            "border-2 border-dashed border-slate-700 rounded-xl p-4 transition-colors",
            "hover:border-emerald-700/50"
          )}
        >
          <div className="flex flex-col gap-3">
            <Textarea
              placeholder={
                'Paste your program text, or describe what you want AI to generate...\n\nExample: "5/3/1 powerlifting program, 4 days/week"\n\nOr drop a PDF/CSV/Excel file here'
              }
              value={text}
              onChange={e => { setText(e.target.value); setShowWizard(false); }}
              rows={6}
              className="bg-slate-900 border-slate-700 resize-none"
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                Upload file
                <input type="file" className="sr-only" accept=".pdf,.docx,.xlsx,.xls,.csv" onChange={handleFileSelect} />
              </label>
              <span className="text-slate-700">·</span>
              {text && !showWizard && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  {detectMode(text) === "generate"
                    ? <><Sparkles className="w-3 h-3 text-purple-400" /> Will generate with AI</>
                    : <><FileText className="w-3 h-3 text-emerald-400" /> Will parse as program text</>
                  }
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-emerald-700/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-slate-200">{file.name}</span>
          </div>
          <button onClick={() => { setFile(null); setSheetNames([]); }} className="text-xs text-slate-500 hover:text-rose-400 transition-colors">Remove</button>
        </div>
      )}

      {sheetNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sheetNames.map(name => (
            <span key={name} className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">{name}</span>
          ))}
        </div>
      )}

      {/* Generate-from-scratch wizard */}
      <button
        onClick={() => setShowWizard(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-purple-400 transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        Generate from scratch with AI
        <ChevronDown className={cn("w-3 h-3 transition-transform duration-150", showWizard && "rotate-180")} />
      </button>

      {showWizard && (
        <div className="space-y-3 pl-2 border-l-2 border-purple-600/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Goal</Label>
              <Select value={goal} onValueChange={setGoal}>
                <SelectTrigger className="bg-slate-900 border-slate-700 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="strength">Strength</SelectItem>
                  <SelectItem value="hypertrophy">Hypertrophy</SelectItem>
                  <SelectItem value="powerlifting">Powerlifting</SelectItem>
                  <SelectItem value="conditioning">Conditioning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Experience</Label>
              <Select value={experience} onValueChange={setExperience}>
                <SelectTrigger className="bg-slate-900 border-slate-700 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Days/week</Label>
              <Input
                type="number" min={1} max={7} value={daysPerWeek}
                onChange={e => setDaysPerWeek(Math.min(7, Math.max(1, parseInt(e.target.value) || 1)))}
                className="bg-slate-900 border-slate-700 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Equipment</Label>
              <Input
                placeholder="barbell, dumbbell..."
                value={equipment}
                onChange={e => setEquipment(e.target.value)}
                className="bg-slate-900 border-slate-700 h-9 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Start date */}
      <div className="space-y-1.5">
        <Label className="text-xs">Program start date</Label>
        <Input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="bg-slate-900 border-slate-700"
        />
      </div>

      {isPending && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {showWizard ? "Generating program..." : "Processing..."}
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={isPending || !isReady}
        className={cn(
          "w-full",
          showWizard ? "bg-purple-600 hover:bg-purple-700" : ""
        )}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : showWizard ? (
          <Sparkles className="h-4 w-4 mr-2" />
        ) : file ? (
          <Upload className="h-4 w-4 mr-2" />
        ) : (
          <FileText className="h-4 w-4 mr-2" />
        )}
        {modeLabel[detectedMode]}
      </Button>
    </div>
  );
}
