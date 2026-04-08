import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api, lbsToKg, kgToLbs } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/DateInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Loader2, Activity, Scale, Droplets, Plus, Trash2, Brain, Eye, EyeOff, Globe, Sun, Moon, LogOut, Target, Users, Download, HardDrive, AlertTriangle, X } from "lucide-react";
import { useLocalModelContext, } from "@/contexts/LocalModelContext";
import type { ModelVariant } from "@/hooks/use-local-model";
import { useQuery } from "@tanstack/react-query";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const localModel = useLocalModelContext();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Weight log form
  const [weightLbs, setWeightLbs] = useState("");
  const [weightDate, setWeightDate] = useState(new Date().toISOString().slice(0, 10));

  // Profile fields
  const [sex, setSex] = useState(user?.sex ?? "male");
  const [dob, setDob] = useState(user?.dateOfBirth ?? "");
  const [heightFt, setHeightFt] = useState(() => {
    if (!user?.heightCm) return "5";
    const totalIn = Math.round(user.heightCm / 2.54);
    return String(Math.floor(totalIn / 12));
  });
  const [heightIn, setHeightIn] = useState(() => {
    if (!user?.heightCm) return "10";
    const totalIn = Math.round(user.heightCm / 2.54);
    return String(totalIn % 12);
  });
  const [activityLevel, setActivityLevel] = useState(user?.activityLevel ?? "moderately_active");
  const [goalType, setGoalType] = useState(user?.goalType ?? "maintenance");
  const [targetWeightLbs, setTargetWeightLbs] = useState(user?.targetWeightKg ? String(kgToLbs(user.targetWeightKg)) : "");
  const [targetDate, setTargetDate] = useState(user?.targetDate ?? "");
  const [burnMode, setBurnMode] = useState(user?.burnMode ?? "tdee");
  const [trainingDays, setTrainingDays] = useState<number[]>(user?.trainingDays as number[] ?? [1, 3, 5]);
  const [meetDate, setMeetDate] = useState(user?.meetDate ?? "");
  const [enableWaterTracking, setEnableWaterTracking] = useState(user?.enableWaterTracking ?? false);
  const [timezone, setTimezone] = useState(() => localStorage.getItem("macro_timezone") ?? "America/New_York");
  useEffect(() => { localStorage.setItem("macro_timezone", timezone); }, [timezone]);
  const [waterUnit, setWaterUnit] = useState<"ml"|"oz"|"L"|"gal">((user as any)?.waterUnit ?? "oz");
  const [waterBottles, setWaterBottles] = useState<Array<{id:string;name:string;mlSize:number}>>((user as any)?.waterBottles ?? []);
  const [newBottleName, setNewBottleName] = useState("");
  const [newBottleSize, setNewBottleSize] = useState("");
  const [newBottleUnit, setNewBottleUnit] = useState<"ml"|"oz"|"L"|"gal">("oz");

  // Conversion constants — everything stored as ml internally
  const ML_TO: Record<string, number> = { ml: 1, oz: 1/29.5735, L: 1/1000, gal: 1/3785.41 };
  const FROM_ML: Record<string, number> = { ml: 1, oz: 29.5735, L: 0.001, gal: 3785.41 };
  const toMl = (val: number, unit: string) => Math.round(val * (FROM_ML[unit] ?? 1));
  // Display a ml value in the user's preferred unit
  const fmtBottle = (ml: number) => {
    const factor = ML_TO[waterUnit] ?? 1;
    const val = +(ml * factor).toFixed(waterUnit === "ml" ? 0 : 2);
    return `${val} ${waterUnit}`;
  };

  const addBottle = () => {
    const size = parseFloat(newBottleSize);
    if (!newBottleName.trim() || isNaN(size) || size <= 0) return;
    const mlSize = toMl(size, newBottleUnit);
    setWaterBottles(prev => [...prev, { id: crypto.randomUUID(), name: newBottleName.trim(), mlSize }]);
    setNewBottleName(""); setNewBottleSize("");
  };

  const removeBottle = (id: string) => setWaterBottles(prev => prev.filter(b => b.id !== id));

  // AI Coach — provider + key (simplified)
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiKeySaving, setAiKeySaving] = useState(false);
  // selectedProvider tracks which tab is active in the UI right now
  const [selectedProvider, setSelectedProvider] = useState<"groq"|"openrouter">("groq");
  const { data: coachProfile } = useQuery({
    queryKey: ["coachProfile"],
    queryFn: () => api.coachProfile().then((r) => r.json()),
  });

  const savedProvider: string = (coachProfile as any)?.provider ?? "groq";
  const savedModel: string   = (coachProfile as any)?.aiModel ?? "";
  const hasOwnKey: boolean   = !!(coachProfile as any)?.hasOwnKey;
  const savedKeys: Record<string, string | null> = (coachProfile as any)?.savedKeys ?? { groq: null, openrouter: null };
  const hasGroqKey: boolean = !!(coachProfile as any)?.hasGroqKey;
  const hasOpenrouterKey: boolean = !!(coachProfile as any)?.hasOpenrouterKey;

  const PROVIDERS = [
    { id: "groq"       as const, label: "Groq",        placeholder: "gsk_...",      url: "https://console.groq.com",    note: "Free tier — fast Llama models" },
    { id: "openrouter" as const, label: "OpenRouter",   placeholder: "sk-or-v1-...", url: "https://openrouter.ai/keys",  note: "BYOK — many free models" },
  ];
  const activeProvider = PROVIDERS.find(p => p.id === selectedProvider) ?? PROVIDERS[0];
  const providerHasKey = (id: string) => id === "groq" ? hasGroqKey : hasOpenrouterKey;

  const saveAiKey = async () => {
    const key = aiKeyInput.trim();
    if (!key) return;
    setAiKeySaving(true);
    try {
      // Save key for the selected provider only — does not touch the other provider's key
      const res = await api.coachSaveApiKey(key, selectedProvider, "");
      const data = await res.json();
      if (!res.ok) { toast({ title: "Error", description: data.error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: "API key saved", description: `${activeProvider.label} — ${data.masked}` });
      setAiKeyInput("");
      await queryClient.invalidateQueries({ queryKey: ["coachProfile"] });
    } catch { toast({ title: "Failed to save key", variant: "destructive" }); }
    finally { setAiKeySaving(false); }
  };
  const removeAiKey = async (provider: "groq" | "openrouter") => {
    await api.coachDeleteApiKey(provider);
    toast({ title: `${PROVIDERS.find(p => p.id === provider)?.label} key removed` });
    await queryClient.invalidateQueries({ queryKey: ["coachProfile"] });
  };


  const saveProfile = async () => {
    setSaving(true);
    try {
      const heightCm = (parseInt(heightFt) * 12 + parseInt(heightIn)) * 2.54;
      const payload: Record<string, any> = {
        sex, dateOfBirth: dob, heightCm, activityLevel, goalType,
        burnMode, trainingDays, enableWaterTracking,
        waterUnit, waterBottles,
        // targetDate and targetWeightKg must be omitted (not null) when empty
        // — the server schema does not accept null for these fields
        ...(targetWeightLbs ? { targetWeightKg: lbsToKg(parseFloat(targetWeightLbs)) } : {}),
        ...(targetDate ? { targetDate } : {}),
        meetDate: meetDate || null,  // meetDate is nullable on the server
      };
      const res = await api.updateProfile(payload);
      const updated = await res.json();
      updateUser(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/targets"] });
      toast({ title: "Settings saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const logWeight = async () => {
    if (!weightLbs || !weightDate) return;
    try {
      await api.logWeight({ date: weightDate, weightKg: lbsToKg(parseFloat(weightLbs)) });
      queryClient.invalidateQueries({ queryKey: ["/api/weight"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setWeightLbs("");
      toast({ title: "Weight logged" });
    } catch {
      toast({ title: "Failed to log weight", variant: "destructive" });
    }
  };


  const isPowerlifting = goalType.includes("powerlifting");

  const OWNER_EMAIL = "owengidusko@gmail.com";
  const isOwner = user?.email === OWNER_EMAIL;

  // Theme toggle
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    if (dark) { root.classList.add("dark"); root.classList.remove("light"); }
    else      { root.classList.remove("dark"); root.classList.add("light"); }
  }, [dark]);

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    logout();
  };

  return (
    <div className="p-4 md:p-6 max-w-xl space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Timezone */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-primary" />Timezone</h2>
        <p className="text-xs text-muted-foreground">Used for displaying sleep times, sync timestamps, and daily date boundaries.</p>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger data-testid="select-timezone"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
            <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
            <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
            <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
            <SelectItem value="America/Anchorage">Alaska Time (AKT)</SelectItem>
            <SelectItem value="Pacific/Honolulu">Hawaii Time (HST)</SelectItem>
            <SelectItem value="America/Phoenix">Arizona (no DST)</SelectItem>
            <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
            <SelectItem value="Europe/Paris">Central European (CET)</SelectItem>
            <SelectItem value="Asia/Tokyo">Japan (JST)</SelectItem>
            <SelectItem value="Australia/Sydney">Sydney (AEST)</SelectItem>
            <SelectItem value="UTC">UTC</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {/* Weight log */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Scale className="w-4 h-4 text-primary" />Log weight</h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type="number" placeholder="175" value={weightLbs}
              onChange={(e) => setWeightLbs(e.target.value)}
              data-testid="input-weight-log"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">lbs</span>
          </div>
          <DateInput value={weightDate} onChange={setWeightDate} testId="input-weight-date" className="flex-1" />
          <Button onClick={logWeight} disabled={!weightLbs} data-testid="button-log-weight">Save</Button>
        </div>
      </section>

      {/* Body stats */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold">Body stats &amp; TDEE</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Sex</Label>
            <Select value={sex} onValueChange={setSex}>
              <SelectTrigger data-testid="select-sex"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Date of birth</Label>
            <DateInput value={dob} onChange={setDob} testId="input-dob" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Height</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input type="number" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} data-testid="input-height-ft" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ft</span>
            </div>
            <div className="relative flex-1">
              <Input type="number" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} data-testid="input-height-in" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">in</span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Activity level</Label>
          <Select value={activityLevel} onValueChange={setActivityLevel}>
            <SelectTrigger data-testid="select-activity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sedentary">Sedentary</SelectItem>
              <SelectItem value="lightly_active">Lightly active (1-3x/week)</SelectItem>
              <SelectItem value="moderately_active">Moderately active (3-5x/week)</SelectItem>
              <SelectItem value="very_active">Very active (6-7x/week)</SelectItem>
              <SelectItem value="extra_active">Extra active (physical job + training)</SelectItem>
            </SelectContent>
          </Select>
        </div>


      </section>

      {/* Goals */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" />Goals</h2>

        <div className="space-y-1.5">
          <Label>Goal type</Label>
          <Select value={goalType} onValueChange={setGoalType}>
            <SelectTrigger data-testid="select-goal"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weight_loss">Weight loss</SelectItem>
              <SelectItem value="weight_gain">Weight gain / bulk</SelectItem>
              <SelectItem value="powerlifting_loss">Powerlifting — cut to weight class</SelectItem>
              <SelectItem value="powerlifting_gain">Powerlifting — gain strength</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {goalType !== "maintenance" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target weight (lbs)</Label>
              <Input type="number" value={targetWeightLbs} onChange={(e) => setTargetWeightLbs(e.target.value)} data-testid="input-target-weight" />
            </div>
            <div className="space-y-1.5">
              <Label>Target date</Label>
              <DateInput value={targetDate} onChange={setTargetDate} testId="input-target-date" />
            </div>
          </div>
        )}

        {isPowerlifting && (
          <>
            <div className="space-y-2">
              <Label>Training days</Label>
              <div className="flex gap-2 flex-wrap">
                {DAYS.map((day, i) => (
                  <button
                    key={i} type="button"
                    data-testid={`button-day-${i}`}
                    onClick={() => setTrainingDays((prev) => prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i])}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      trainingDays.includes(i)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary border-border hover:border-primary"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Meet date</Label>
              <DateInput value={meetDate} onChange={setMeetDate} testId="input-meet-date" />
            </div>

          </>
        )}

        {/* Water tracking — available to ALL users */}
        <div className="border-t border-border pt-3 space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              id="watertracking" checked={enableWaterTracking}
              onCheckedChange={setEnableWaterTracking}
              data-testid="switch-water-tracking"
            />
            <div>
              <Label htmlFor="watertracking" className="cursor-pointer">Enable water intake tracking</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows a daily water tracker on the dashboard.
                {user?.meetDate ? " During peak week, targets follow your powerlifting protocol. Otherwise uses" : " Uses"} evidence-based targets based on your weight, sex, and age.
              </p>
            </div>
          </div>

          {enableWaterTracking && (
            <div className="space-y-3 pl-1">
              <div className="flex items-center gap-3">
                <Droplets className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <Label className="text-xs flex-shrink-0">Display unit</Label>
                <Select value={waterUnit} onValueChange={(v) => setWaterUnit(v as any)}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oz">oz</SelectItem>
                    <SelectItem value="ml">ml</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                    <SelectItem value="gal">gal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Water bottles</p>
                {waterBottles.length === 0 && (
                  <p className="text-xs text-muted-foreground">No bottles saved yet.</p>
                )}
                {waterBottles.map((b) => (
                  <div key={b.id} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                    <span className="text-sm font-medium">{b.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{fmtBottle(b.mlSize)}</span>
                      <button onClick={() => removeBottle(b.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 items-end pt-1">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input placeholder="e.g. Hydroflask 32oz" value={newBottleName} onChange={(e) => setNewBottleName(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs">Size</Label>
                    <Input type="number" min="1" placeholder="32" value={newBottleSize} onChange={(e) => setNewBottleSize(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <Select value={newBottleUnit} onValueChange={(v) => setNewBottleUnit(v as any)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="oz">oz</SelectItem>
                        <SelectItem value="ml">ml</SelectItem>
                        <SelectItem value="L">L</SelectItem>
                        <SelectItem value="gal">gal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" className="h-8" onClick={addBottle}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>


      {/* AI Coach — provider + key */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Coach</h2>
        </div>

        {/* Per-provider saved key badges */}
        {(hasGroqKey || hasOpenrouterKey) && (
          <div className="space-y-1.5">
            {PROVIDERS.map(p => {
              if (!providerHasKey(p.id)) return null;
              const isActive = savedProvider === p.id;
              return (
                <div key={p.id} className="flex items-center justify-between bg-secondary rounded-xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className={`w-4 h-4 ${isActive ? "text-green-400" : "text-muted-foreground"}`} />
                    <div>
                      <p className="text-xs font-semibold">
                        {p.label}
                        {savedKeys[p.id] && <span className="text-muted-foreground font-normal"> — {savedKeys[p.id]}</span>}
                        {isActive && <span className="text-green-400 font-normal"> (active)</span>}
                      </p>
                      {isActive && savedModel && (
                        <p className="text-xs text-muted-foreground">
                          Model: {savedModel.split("/").pop()?.replace(":free","") ?? savedModel} — select in Coach tab
                        </p>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => removeAiKey(p.id)} className="h-7 text-xs">Remove</Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Step 1: pick provider */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">1. Select provider</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProvider(p.id)}
                className={`py-2.5 px-1 rounded-xl border text-xs font-medium transition-colors flex flex-col items-center gap-0.5 ${
                  selectedProvider === p.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary hover:border-primary/40"
                }`}
              >
                <span>{p.label}{providerHasKey(p.id) ? " ✓" : ""}</span>
                <span className={`text-[10px] font-normal ${ selectedProvider === p.id ? "text-primary/70" : "text-muted-foreground"}`}>{p.note}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: paste key */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">
            2. Paste your {activeProvider.label} API key{" "}
            <a href={activeProvider.url} target="_blank" rel="noopener noreferrer" className="underline text-primary font-normal">Get free key →</a>
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showAiKey ? "text" : "password"}
                placeholder={activeProvider.placeholder}
                value={aiKeyInput}
                onChange={e => setAiKeyInput(e.target.value)}
                className="pr-8 text-sm h-9"
                onKeyDown={e => { if (e.key === "Enter") saveAiKey(); }}
              />
              <button type="button" onClick={() => setShowAiKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showAiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <Button size="sm" onClick={saveAiKey} disabled={!aiKeyInput.trim() || aiKeySaving} className="h-9">
              {aiKeySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {providerHasKey(selectedProvider)
              ? `${activeProvider.label} key saved — paste a new key to replace it.`
              : `Without a key you get ${(coachProfile as any)?.dailyCap ?? 15} free messages/day via Groq.`}
            {" "}Pick your AI model in the Coach tab after saving.
          </p>
        </div>
      </section>

      {/* AI Coach — Local Model */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Coach — Local Model</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Download a local AI model for offline coach chat. The model runs entirely in your browser — no data sent to any server.
        </p>

        {!localModel.hasWebGPU && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">
              WebGPU is not available in this browser. The local model requires WebGPU — use Chrome 113+ or Edge 113+ on desktop, or use the cloud model instead.
            </p>
          </div>
        )}

        {localModel.error && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{localModel.error}</p>
          </div>
        )}

        {/* Model options */}
        <div className="space-y-2">
          {([
            { id: "E2B" as ModelVariant, label: "Gemma 4 E2B", size: "~3.5 GB", desc: "Faster download, good for coaching" },
            { id: "E4B" as ModelVariant, label: "Gemma 4 E4B", size: "~6 GB", desc: "Larger, better structured responses" },
          ]).map((opt) => {
            const isThisVariant = localModel.variant === opt.id;
            // Model is fully ready: variant matches, loaded into memory, not currently loading
            const isFullyReady = isThisVariant && localModel.ready && !localModel.loading;
            // Model is reloading from cache (mount reload, no downloadingVariant set)
            const isReloading = isThisVariant && localModel.loading && !localModel.downloadingVariant;
            // Model variant is stored but not yet loaded (brief window before mount effect fires,
            // or between renders) — treat as "pending reload"
            const isPendingReload = isThisVariant && !localModel.ready && !localModel.loading;
            // Fresh download in progress for this specific variant
            const isDownloading = localModel.loading && localModel.downloadingVariant === opt.id;
            // Any loading happening (disable all download buttons)
            const isCurrentlyDownloading = localModel.loading;

            return (
              <div key={opt.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{opt.label} <span className="text-xs text-muted-foreground">({opt.size})</span></p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </div>
                  {isFullyReady ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-500 font-medium flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Installed
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => localModel.removeModel()}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        title="Remove model"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (isReloading || isPendingReload) ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">Loading from cache...</span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => localModel.downloadModel(opt.id)}
                      disabled={isCurrentlyDownloading}
                      className="h-8 text-xs"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      ) : (
                        <Download className="w-3.5 h-3.5 mr-1" />
                      )}
                      {isDownloading ? "Downloading..." : "Download"}
                    </Button>
                  )}
                </div>

                {/* Progress bar — show during fresh download only (not cache reload) */}
                {isDownloading && (
                  <div className="space-y-1">
                    <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${localModel.downloadProgress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{localModel.statusText}</span>
                      <span>
                        {localModel.downloadProgress}%
                        {localModel.totalBytes > 0 && (
                          <> — {formatBytes(localModel.downloadedBytes)} / {formatBytes(localModel.totalBytes)}</>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick links */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-2">
        <h2 className="font-semibold text-sm mb-2">Quick links</h2>
        <Link
          href="/plan"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Target className="w-4 h-4" />
          Diet Plan &amp; TDEE Calculator
        </Link>
        <Link
          href="/history"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Scale className="w-4 h-4" />
          Meal History
        </Link>
        {isOwner && (
          <Link
            href="/invites"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Users className="w-4 h-4" />
            Invite Codes
          </Link>
        )}
      </section>

      {/* Appearance */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-sm">Appearance</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {dark ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-primary" />}
            <span className="text-sm">{dark ? "Dark mode" : "Light mode"}</span>
          </div>
          <Switch checked={dark} onCheckedChange={setDark} />
        </div>
      </section>

      <Button onClick={saveProfile} disabled={saving} className="w-full" data-testid="button-save-settings">
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save settings"}
      </Button>

      {/* Sign out */}
      <Button
        variant="outline"
        onClick={handleLogout}
        className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/50"
        data-testid="button-logout"
      >
        <LogOut className="w-4 h-4 mr-2" />
        Sign out
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
          Created with Perplexity Computer
        </a>
      </p>
    </div>
  );
}
