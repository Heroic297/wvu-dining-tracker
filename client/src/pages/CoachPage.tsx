/**
 * CoachPage — AI health + nutrition coach tab.
 *
 * Layout:
 *  - Mobile: full-width chat, sheet sidebar via "Coach Knows" button
 *  - Desktop: chat (left 2/3) + sidebar panel (right 1/3)
 *
 * Onboarding: first-time Q+A flow rendered in place of the chat input.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

import {
  Brain,
  Send,
  Trash2,
  ChevronRight,
  AlertCircle,
  Sparkles,
  Info,
  BookOpen,
  X,
  Settings2,
  RefreshCw,
  Check,
  Pencil,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: boolean;
  model?: string;
  provider?: string;
}

interface CoachProfile {
  onboardingComplete: boolean;
  preferredName?: string;
  mainGoal?: string;
  isWvuStudent?: boolean;
  experienceLevel?: string;
  notes?: string;
  coachTone?: "coach" | "data" | "balanced";
  rollingSummary?: string;
  aiModel?: string;
  aiProvider?: string;
  status?: string;
}

// ─── Onboarding Q+A ──────────────────────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    id: "preferredName",
    question: "What should I call you? (feel free to use a nickname)",
    placeholder: "e.g. Owen, Coach O, Big O...",
    type: "text" as const,
  },
  {
    id: "mainGoal",
    question: "What's your main goal right now?",
    type: "choice" as const,
    choices: [
      { value: "powerlifting", label: "Powerlifting / competition prep" },
      { value: "lose_weight", label: "Lose weight / cut body fat" },
      { value: "build_muscle", label: "Build muscle / bulk" },
      { value: "general_fitness", label: "General health & fitness" },
      { value: "other", label: "Other" },
    ],
  },
  {
    id: "isWvuStudent",
    question: "Are you a WVU student? (this lets me pull dining hall menus for you)",
    type: "choice" as const,
    choices: [
      { value: "yes", label: "Yes, I'm a WVU student" },
      { value: "no", label: "No" },
    ],
  },
  {
    id: "experienceLevel",
    question: "How would you describe your experience with tracking nutrition and training?",
    type: "choice" as const,
    choices: [
      { value: "beginner", label: "Just getting started" },
      { value: "intermediate", label: "Some experience, still learning" },
      { value: "advanced", label: "Very familiar, I know my numbers" },
    ],
  },
  {
    id: "notes",
    question: "Anything I should keep in mind? (injuries, dietary restrictions, preferences — or just skip)",
    placeholder: "e.g. left shoulder impingement, lactose intolerant, hate cardio...",
    type: "text" as const,
    optional: true,
  },
  {
    id: "coachTone",
    question: "How do you want me to communicate?",
    type: "choice" as const,
    choices: [
      { value: "coach", label: "Coach mode — motivational, plain English" },
      { value: "balanced", label: "Balanced — direct but supportive" },
      { value: "data", label: "Data mode — precise, numbers-first" },
    ],
  },
];

function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [textInput, setTextInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Track selected tone for the confirm step
  const [selectedTone, setSelectedTone] = useState("");
  const qc = useQueryClient();

  const current = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  // Advance to next step or record answer
  function advance(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setTextInput("");
    setSaveError("");
    if (!isLast) setStep((s) => s + 1);
  }

  // Final save — called explicitly from the Finish button
  async function finishSetup(tone: string) {
    const finalAnswers: Record<string, string> = { ...answers, coachTone: tone };
    setSaving(true);
    setSaveError("");
    try {
      const res = await api.coachUpdateProfile({
        preferredName: finalAnswers.preferredName ?? "",
        mainGoal: finalAnswers.mainGoal ?? "general_fitness",
        isWvuStudent: finalAnswers.isWvuStudent === "yes",
        experienceLevel: finalAnswers.experienceLevel ?? "intermediate",
        notes: finalAnswers.notes ?? "",
        coachTone: (tone as any) ?? "balanced",
        onboardingComplete: true,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        setSaveError(err.error ?? "Setup failed — please try again");
        setSaving(false);
        return;
      }
      qc.invalidateQueries({ queryKey: ["coachProfile"] });
      onComplete();
    } catch (e: any) {
      setSaveError(e?.message ?? "Network error — please try again");
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
      {/* Progress dots */}
      <div className="flex gap-1.5">
        {ONBOARDING_STEPS.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors ${
              i < step ? "bg-primary" : i === step ? "bg-primary/70" : "bg-secondary"
            }`}
          />
        ))}
      </div>

      <div className="w-full max-w-md space-y-4">
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Brain className="w-4 h-4 text-primary" />
            </div>
            <p className="text-sm leading-relaxed">{current.question}</p>
          </div>

          {current.type === "choice" && !isLast && (
            <div className="space-y-2 pl-11">
              {current.choices!.map((c) => (
                <button
                  key={c.value}
                  onClick={() => advance(current.id, c.value)}
                  className="w-full text-left px-4 py-2.5 rounded-xl border border-border bg-secondary hover:bg-secondary/80 hover:border-primary/40 text-sm font-medium transition-colors"
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {/* Last step: tone selector — pick then explicitly confirm */}
          {isLast && (
            <div className="space-y-3 pl-11">
              {current.choices!.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setSelectedTone(c.value)}
                  disabled={saving}
                  className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    selectedTone === c.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary hover:bg-secondary/80 hover:border-primary/40"
                  }`}
                >
                  {c.label}
                </button>
              ))}
              {selectedTone && (
                <Button
                  className="w-full mt-1"
                  onClick={() => finishSetup(selectedTone)}
                  disabled={saving}
                >
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      Setting up...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Finish setup
                    </span>
                  )}
                </Button>
              )}
              {saveError && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{saveError}</p>
                </div>
              )}
            </div>
          )}

          {current.type === "text" && (
            <div className="pl-11 space-y-2">
              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={current.placeholder}
                className="text-sm resize-none min-h-[80px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && textInput.trim()) {
                    e.preventDefault();
                    advance(current.id, textInput.trim());
                  }
                }}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => advance(current.id, textInput.trim())}
                  disabled={!textInput.trim() && !current.optional}
                >
                  Next
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
                {current.optional && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => advance(current.id, "")}
                  >
                    Skip
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Coach Knows Sidebar ──────────────────────────────────────────────────────

function CoachKnows({
  profile,
  onClearMemory,
  clearing,
}: {
  profile: CoachProfile;
  onClearMemory: () => void;
  clearing: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Edit form state — initialised from current profile
  const [editName, setEditName] = useState(profile.preferredName ?? "");
  const [editGoal, setEditGoal] = useState(profile.mainGoal ?? "general_fitness");
  const [editWvu, setEditWvu] = useState(profile.isWvuStudent ?? false);
  const [editExp, setEditExp] = useState(profile.experienceLevel ?? "intermediate");
  const [editNotes, setEditNotes] = useState(profile.notes ?? "");
  const [editTone, setEditTone] = useState<"coach" | "data" | "balanced">((profile.coachTone as any) ?? "balanced");

  // Reset edit state when profile changes (e.g. after save)
  const openEdit = () => {
    setEditName(profile.preferredName ?? "");
    setEditGoal(profile.mainGoal ?? "general_fitness");
    setEditWvu(profile.isWvuStudent ?? false);
    setEditExp(profile.experienceLevel ?? "intermediate");
    setEditNotes(profile.notes ?? "");
    setEditTone((profile.coachTone as any) ?? "balanced");
    setSaveError("");
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await api.coachUpdateProfile({
        preferredName: editName,
        mainGoal: editGoal,
        isWvuStudent: editWvu,
        experienceLevel: editExp,
        notes: editNotes,
        coachTone: editTone as any,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError(err.error ?? "Save failed");
        return;
      }
      qc.invalidateQueries({ queryKey: ["coachProfile"] });
      setEditing(false);
    } catch (e: any) {
      setSaveError(e?.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  };

  const goalLabels: Record<string, string> = {
    powerlifting: "Powerlifting / competition prep",
    lose_weight: "Lose weight / cut body fat",
    build_muscle: "Build muscle / bulk",
    general_fitness: "General health & fitness",
    other: "Other",
  };
  const toneLabels: Record<string, string> = {
    coach: "Coach mode",
    balanced: "Balanced",
    data: "Data mode",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">What I know about you</h3>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={openEdit}>
            <Pencil className="w-3 h-3" /> Edit
          </Button>
        )}
      </div>

      {/* ── Edit mode ── */}
      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Name</p>
            <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-xs" placeholder="Your name" />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Main goal</p>
            <div className="space-y-1">
              {Object.entries(goalLabels).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setEditGoal(val)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    editGoal === val
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Experience level</p>
            <div className="flex gap-1.5">
              {(["beginner", "intermediate", "advanced"] as const).map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setEditExp(lvl)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors ${
                    editExp === lvl
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary hover:border-primary/40"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Communication style</p>
            <div className="space-y-1">
              {Object.entries(toneLabels).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setEditTone(val as any)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    editTone === val
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">WVU student?</p>
            <div className="flex gap-1.5">
              {([true, false] as const).map(v => (
                <button
                  key={String(v)}
                  onClick={() => setEditWvu(v)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    editWvu === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary hover:border-primary/40"
                  }`}
                >
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Notes & preferences</p>
            <Textarea
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Injuries, dietary restrictions, preferences..."
              className="text-xs resize-none min-h-[64px]"
            />
          </div>

          {saveError && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{saveError}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1" onClick={saveEdit} disabled={saving}>
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Saving...
                </span>
              ) : (
                <span className="flex items-center gap-1.5"><Check className="w-3 h-3" /> Save changes</span>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        /* ── Read mode ── */
        <>
          <div className="space-y-2 text-sm">
            {profile.preferredName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{profile.preferredName}</span>
              </div>
            )}
            {profile.mainGoal && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground flex-shrink-0">Goal</span>
                <span className="font-medium text-right">{goalLabels[profile.mainGoal] ?? profile.mainGoal}</span>
              </div>
            )}
            {profile.isWvuStudent !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">WVU student</span>
                <span className="font-medium">{profile.isWvuStudent ? "Yes" : "No"}</span>
              </div>
            )}
            {profile.experienceLevel && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Experience</span>
                <span className="font-medium capitalize">{profile.experienceLevel}</span>
              </div>
            )}
            {profile.coachTone && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tone</span>
                <span className="font-medium">{toneLabels[profile.coachTone] ?? profile.coachTone}</span>
              </div>
            )}
          </div>

          {profile.notes && (
            <div className="bg-secondary rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Notes & preferences</p>
              <p className="text-xs leading-relaxed">{profile.notes}</p>
            </div>
          )}

          {profile.rollingSummary && (
            <div className="bg-secondary rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Conversation memory</p>
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{profile.rollingSummary}</p>
            </div>
          )}

          {!profile.rollingSummary && !profile.notes && (
            <p className="text-xs text-muted-foreground">
              Memory builds as you chat. After 20 messages I'll start compacting older ones into a summary that lives here.
            </p>
          )}

          {/* Clear memory */}
          <div className="border-t border-border pt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="w-full" disabled={clearing}>
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  Clear all memory &amp; history
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear AI Coach memory?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes your full chat history and the AI's memory of you. You will go through the onboarding Q+A again. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onClearMemory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Yes, clear everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0, m: RegExpExecArray | null, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    if (m[1] !== undefined) parts.push(<strong key={key++} className="font-semibold">{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<em key={key++} className="italic">{m[2]}</em>);
    else if (m[3] !== undefined) parts.push(<code key={key++} className="bg-black/10 dark:bg-white/10 px-1 rounded text-xs font-mono">{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;
  let lk = 0;
  const flushList = () => {
    if (!listItems.length) return;
    nodes.push(listType === "ul"
      ? <ul key={`ul${lk++}`} className="list-disc pl-4 space-y-0.5 my-1">{listItems}</ul>
      : <ol key={`ol${lk++}`} className="list-decimal pl-4 space-y-0.5 my-1">{listItems}</ol>);
    listItems = []; listType = null;
  };
  lines.forEach((line, i) => {
    const h3 = line.match(/^###\s+(.+)/), h2 = line.match(/^##\s+(.+)/), h1 = line.match(/^#\s+(.+)/);
    const bullet = line.match(/^[-*]\s+(.+)/), numbered = line.match(/^\d+\.\s+(.+)/);
    if (h1 || h2 || h3) {
      flushList();
      const t = (h3||h2||h1)![1];
      const cls = h1 ? "text-base font-bold mt-2" : h2 ? "text-sm font-bold mt-2" : "text-sm font-semibold mt-1.5";
      nodes.push(<p key={i} className={cls}>{renderInline(t)}</p>);
    } else if (bullet) {
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listItems.push(<li key={i}>{renderInline(bullet[1])}</li>);
    } else if (numbered) {
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listItems.push(<li key={i}>{renderInline(numbered[1])}</li>);
    } else if (line.match(/^---+$/)) {
      flushList(); nodes.push(<hr key={i} className="border-border my-1.5" />);
    } else if (line.trim() === "") {
      flushList();
      if (i > 0 && i < lines.length - 1) nodes.push(<div key={i} className="h-1" />);
    } else {
      flushList(); nodes.push(<p key={i} className="leading-relaxed">{renderInline(line)}</p>);
    }
  });
  flushList();
  return <>{nodes}</>;
}

const MODEL_LABELS: Record<string, string> = {
  "openrouter/free":                             "Auto (Free)",
  "qwen/qwen3.6-plus:free":                     "Qwen 3.6 Plus",
  "meta-llama/llama-3.3-70b-instruct:free":      "Llama 3.3 70B",
  "nvidia/nemotron-3-super-120b-a12b:free":      "Nemotron 120B",
  "stepfun/step-3.5-flash:free":                 "Step 3.5 Flash",
  "llama-3.3-70b-versatile":                     "Llama 3.3 70B",
  "llama-3.1-8b-instant":                        "Llama 3.1 8B",
};
const PROVIDER_LABELS: Record<string, string> = { groq: "Groq", openrouter: "OpenRouter", local: "On-Device" };

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const watermark = !isUser && !msg.pending && msg.model
    ? `${MODEL_LABELS[msg.model] ?? msg.model.split("/").pop()?.replace(":free","") ?? msg.model}${msg.provider ? ` · ${PROVIDER_LABELS[msg.provider] ?? msg.provider}` : ""}`
    : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-emerald-900/40 border border-emerald-800/30 rounded-2xl rounded-br-sm px-4 py-3">
          <p className="text-sm text-slate-200">{msg.content}</p>
        </div>
      </div>
    );
  }

  // Typing indicator for pending messages
  if (msg.pending) {
    return (
      <div className="flex justify-start gap-2">
        <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay: '0ms'}} />
            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay: '150ms'}} />
            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{animationDelay: '300ms'}} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-2">
      <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
      </div>
      <div className="flex flex-col items-start max-w-[80%]">
        <div
          className={`rounded-2xl rounded-bl-sm px-4 py-3 text-sm ${
            msg.error
              ? "bg-destructive/10 border border-destructive/30 text-destructive-foreground"
              : "bg-slate-800"
          }`}
        >
          <div className="text-sm text-slate-200">{renderMarkdown(msg.content)}</div>
        </div>
        {watermark && (
          <p className="text-[10px] text-slate-500 mt-0.5 px-1 select-none">{watermark}</p>
        )}
      </div>
    </div>
  );
}

// ─── No Key Banner ────────────────────────────────────────────────────────────

function NoKeyBanner() {
  return (
    <div className="mx-4 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5">
      <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="text-xs space-y-1">
        <p className="font-semibold text-amber-400">Add a free API key for unlimited messages</p>
        <p className="text-muted-foreground">
          Go to <strong>Settings → AI Coach</strong> to pick a provider (Groq or OpenRouter) and add your free key. Both providers offer free tiers.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CoachPage() {
  const qc = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLInputElement>(null);

  // Profile query
  const { data: profile, isLoading: profileLoading } = useQuery<CoachProfile>({
    queryKey: ["coachProfile"],
    queryFn: () => api.coachProfile().then((r) => r.json()),
  });

  // History query (only load once onboarding is done)
  const { data: historyData } = useQuery({
    queryKey: ["coachHistory"],
    queryFn: () => api.coachHistory().then((r) => r.json()),
    enabled: !!profile?.onboardingComplete,
  });

  // Load history into messages on mount
  useEffect(() => {
    if (historyData?.messages && messages.length === 0) {
      const loaded: Message[] = historyData.messages
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any) => ({ role: m.role, content: m.content }));
      setMessages(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyData]);

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Build a lightweight system prompt from profile for local inference ──
  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      return api.coachChat(message).then((r) => r.json());
    },
    onMutate: (message) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "Thinking...", pending: true },
      ]);
      setIsStreaming(true);
    },
    onSuccess: (data) => {
      setIsStreaming(false);
      if (data.error) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.error, error: true },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: data.message, model: data.model, provider: data.provider },
      ]);
    },
    onError: () => {
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
          error: true,
        },
      ]);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => api.coachClearMemory().then((r) => r.json()),
    onSuccess: () => {
      setMessages([]);
      qc.invalidateQueries({ queryKey: ["coachProfile"] });
      qc.invalidateQueries({ queryKey: ["coachHistory"] });
    },
  });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMutation.mutate(text);
  }, [input, isStreaming, sendMutation]);

  const handleSuggestedPrompt = useCallback((prompt: string) => {
    if (isStreaming) return;
    setInput("");
    sendMutation.mutate(prompt);
  }, [isStreaming, sendMutation]);


  // ── Render ────────────────────────────────────────────────────────────────

  if (profileLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // First-time onboarding
  if (profile && !profile.onboardingComplete) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Brain className="w-5 h-5 text-primary" />
          <h1 className="text-base font-semibold">Coach</h1>
          <Badge variant="secondary" className="text-xs">Setup</Badge>
        </div>
        <OnboardingFlow onComplete={() => qc.invalidateQueries({ queryKey: ["coachProfile"] })} />
      </div>
    );
  }

  const sidebarContent = profile ? (
    <CoachKnows
      profile={profile}
      onClearMemory={() => clearMutation.mutate()}
      clearing={clearMutation.isPending}
    />
  ) : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0 h-full text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-slate-950/40 backdrop-blur-lg flex-shrink-0">
          <div className="flex items-center gap-2">
            <Brain
              className="w-5 h-5 text-emerald-400"
              style={{ filter: "drop-shadow(0 0 6px hsl(158 64% 42% / 0.5))" }}
            />
            <h1
              className="text-lg font-bold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <span className="gradient-text">Coach</span>
              {profile?.preferredName ? <span className="text-slate-300"> · {profile.preferredName}</span> : null}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs text-slate-400 hidden sm:inline-flex">
              DeepSeek V4 Pro · NVIDIA NIM
            </Badge>
            {/* Mobile: Coach Knows sheet trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="lg:hidden text-xs gap-1.5 text-slate-400 hover:text-slate-200">
                  <Info className="w-3.5 h-3.5" />
                  Coach Knows
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    Coach Profile
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-4">{sidebarContent}</div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Scrollable messages area */}
        <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-lg font-semibold text-slate-300 mb-1">AI Nutrition Coach</h2>
              <p className="text-sm text-slate-500 mb-6">Ask me anything about your nutrition, goals, or meal planning.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {["What should I eat today?", "Am I hitting my protein goal?", "Suggest a high-protein snack", "How many calories left?"].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSuggestedPrompt(prompt)}
                    className="rounded-full px-3 py-1.5 text-xs font-medium bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer hover:border-emerald-500/50 hover:text-emerald-400 transition-all duration-200"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Fixed input */}
        <div className="border-t border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 pb-20 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <input
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask your coach..."
              className="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all duration-200"
              disabled={isStreaming}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white p-3 transition-colors duration-200 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:flex flex-col w-72 border-l border-border overflow-y-auto p-4 flex-shrink-0">
        {sidebarContent}
      </div>
    </div>
  );
}
