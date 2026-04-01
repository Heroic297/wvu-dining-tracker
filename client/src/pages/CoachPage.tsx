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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  hasOwnKey: boolean;
  dailyUsage: number;
  dailyCap: number;
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
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">What I know about you</h3>
      </div>

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

      {/* Usage meter (only shown if no own key) */}
      {!profile.hasOwnKey && (
        <div className="border-t border-border pt-3 space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Free messages today</p>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (profile.dailyUsage / profile.dailyCap) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {profile.dailyUsage} / {profile.dailyCap} used
            {profile.dailyUsage >= profile.dailyCap && " — add your Groq key in Settings for unlimited"}
          </p>
        </div>
      )}

      {profile.hasOwnKey && (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <Check className="w-3.5 h-3.5" />
          <span>Using your Groq API key — unlimited messages</span>
        </div>
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
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Brain className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : msg.error
            ? "bg-destructive/10 border border-destructive/30 text-destructive-foreground rounded-bl-sm"
            : "bg-card border border-border rounded-bl-sm"
        } ${msg.pending ? "opacity-60 animate-pulse" : ""}`}
      >
        {msg.content.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < msg.content.split("\n").length - 1 && <br />}
          </span>
        ))}
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
        <p className="font-semibold text-amber-400">Add your Groq API key for unlimited messages</p>
        <p className="text-muted-foreground">
          Go to <strong>Settings → AI Coach</strong> and paste your free Groq key.
          Sign up at{" "}
          <a
            href="https://console.groq.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-amber-400"
          >
            console.groq.com
          </a>{" "}
          — it takes 30 seconds and is completely free.
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
  const [showNeedKey, setShowNeedKey] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const sendMutation = useMutation({
    mutationFn: (message: string) => api.coachChat(message).then((r) => r.json()),
    onMutate: (message) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "Thinking...", pending: true },
      ]);
      setIsStreaming(true);
      setShowNeedKey(false);
    },
    onSuccess: (data) => {
      setIsStreaming(false);
      if (data.needsKey) {
        setShowNeedKey(true);
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.error, error: true },
        ]);
        return;
      }
      if (data.error) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.error, error: true },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: data.message },
      ]);
      // Refresh profile (daily usage may have changed)
      qc.invalidateQueries({ queryKey: ["coachProfile"] });
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
      setShowNeedKey(false);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold">
              Coach{profile?.preferredName ? ` · ${profile.preferredName}` : ""}
            </h1>
            {profile?.hasOwnKey && (
              <Badge variant="secondary" className="text-xs hidden sm:flex">Unlimited</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile: Coach Knows sheet trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="lg:hidden text-xs gap-1.5">
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {profile?.preferredName ? `Hey ${profile.preferredName}!` : "Hey!"} I'm your Macro Coach.
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Ask me anything — macro targets, meal ideas, training nutrition, peak week guidance, dining hall options, or just what to eat tonight.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {[
                  "Explain my calorie target today",
                  "What should I eat before training?",
                  ...(profile?.isWvuStudent ? ["What's at the dining hall tomorrow?"] : []),
                  "How am I tracking this week?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); textareaRef.current?.focus(); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-border bg-secondary hover:bg-secondary/80 hover:border-primary/40 transition-colors"
                  >
                    {suggestion}
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

        {/* Need key banner */}
        {showNeedKey && !profile?.hasOwnKey && <NoKeyBanner />}

        {/* Input */}
        <div className="border-t border-border px-3 py-3 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your coach anything..."
              className="resize-none min-h-[44px] max-h-[120px] text-sm flex-1"
              rows={1}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="flex-shrink-0 h-[44px] w-[44px]"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:flex flex-col w-72 border-l border-border overflow-y-auto p-4 flex-shrink-0">
        {sidebarContent}
      </div>
    </div>
  );
}
