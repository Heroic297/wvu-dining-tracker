import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api, lbsToKg, kgToLbs, fmtLbs } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/DateInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Activity, Scale, Droplets, Plus, Trash2, Brain, Globe, Sun, Moon, LogOut, Target, Users, ShieldAlert } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
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
  const [targetWeightLbs, setTargetWeightLbs] = useState(user?.targetWeightKg ? fmtLbs(kgToLbs(user.targetWeightKg)) : "");
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
    <div className="p-4 md:p-6 max-w-xl space-y-6 fade-up">
      <h1
        className="text-3xl font-extrabold gradient-text"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Settings
      </h1>

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


      {/* AI Coach */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Coach</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-sm font-medium text-green-400">Connected</span>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>Model</span>
            <span className="text-foreground font-medium">DeepSeek V4 Pro</span>
          </div>
          <div className="flex justify-between">
            <span>Provider</span>
            <span className="text-foreground font-medium">NVIDIA NIM</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">AI is provided automatically — no API key required</p>
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

      {/* Data & History — Danger Zone */}
      <DangerZone />

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

// ─── Danger Zone: wipe polluted test/debug data ─────────────────────────────
//
// Rendered as its own component so all the preview / confirmation state stays
// colocated and doesn't clutter the main SettingsPage. The server requires an
// explicit `confirm: "DELETE"` body field, so we gate the action behind the
// user typing DELETE into a confirmation input.

type HistoryCounts = {
  meals: number;
  weightLogs: number;
  waterLogs: number;
  supplementLogs: number;
  workoutLogs: number;
};

type HistoryScopeKey = keyof HistoryCounts | "coachMemory";

const SCOPE_LABELS: Record<HistoryScopeKey, { label: string; desc: string }> = {
  meals:          { label: "Meals",            desc: "Logged meals and every item inside them" },
  weightLogs:     { label: "Weight log",       desc: "All weigh-ins" },
  waterLogs:      { label: "Water log",        desc: "Daily ml totals" },
  supplementLogs: { label: "Supplement log",   desc: "Daily supplement servings (keeps supplements themselves)" },
  workoutLogs:    { label: "Workout log",      desc: "Training-log entries (keeps the program itself)" },
  coachMemory:    { label: "Coach memory",     desc: "Chat history + the rolling summary (profile preferences kept)" },
};

function DangerZone() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scopes, setScopes] = useState<Record<HistoryScopeKey, boolean>>({
    meals: true,
    weightLogs: false,
    waterLogs: false,
    supplementLogs: false,
    workoutLogs: false,
    coachMemory: false,
  });
  const [counts, setCounts] = useState<HistoryCounts | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const toggleScope = (k: HistoryScopeKey) =>
    setScopes(prev => ({ ...prev, [k]: !prev[k] }));

  const anyScopeSelected = Object.values(scopes).some(Boolean);
  const anyTableScope = (Object.keys(scopes) as HistoryScopeKey[])
    .filter(k => k !== "coachMemory")
    .some(k => scopes[k]);

  const refreshPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await api.previewHistoryClear(
        startDate || undefined,
        endDate || undefined,
      );
      const data = await res.json();
      setCounts(data.counts);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  // Refresh preview whenever the dialog is opened or dates change
  useEffect(() => {
    if (!open) return;
    void refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startDate, endDate]);

  const selectedRowTotal = counts
    ? (Object.keys(SCOPE_LABELS) as HistoryScopeKey[])
        .filter(k => k !== "coachMemory" && scopes[k])
        .reduce((sum, k) => sum + (counts[k as keyof HistoryCounts] ?? 0), 0)
    : 0;

  const submit = async () => {
    if (!anyScopeSelected) return;
    if (confirmText.trim() !== "DELETE") {
      toast({ title: "Type DELETE to confirm", variant: "destructive" });
      return;
    }
    setDeleting(true);
    try {
      const res = await api.clearHistory({
        confirm: "DELETE",
        startDate: startDate || undefined,
        endDate:   endDate   || undefined,
        meals:          scopes.meals,
        weightLogs:     scopes.weightLogs,
        waterLogs:      scopes.waterLogs,
        supplementLogs: scopes.supplementLogs,
        workoutLogs:    scopes.workoutLogs,
        coachMemory:    scopes.coachMemory,
      });
      const { deleted } = await res.json();
      const total =
        deleted.meals + deleted.weightLogs + deleted.waterLogs +
        deleted.supplementLogs + deleted.workoutLogs;
      toast({
        title: "History cleared",
        description: `Removed ${total} row${total === 1 ? "" : "s"}${deleted.coachMemoryCleared ? " + coach memory" : ""}.`,
      });
      // Invalidate anything that could be showing stale data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/meals"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/meals/range"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/weight"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/targets"] }),
      ]);
      setConfirmText("");
      setOpen(false);
    } catch (err: any) {
      toast({ title: "Clear failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="bg-card border border-destructive/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-destructive" />
        <h2 className="font-semibold text-sm">Data &amp; History</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Clean up stale test or debug data that&rsquo;s polluting your account. You
        choose exactly which tables and which date range to clear. Profile info
        and settings are never touched.
      </p>

      <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmText(""); }}>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="w-full text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            data-testid="button-open-clear-history"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear history…
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-destructive" />
              Clear account history
            </AlertDialogTitle>
            <AlertDialogDescription>
              Permanent and per-table. Leave both date fields empty to clear the
              entire history for the tables you select.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            {/* Date range */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Start date</Label>
                <DateInput value={startDate} onChange={setStartDate} testId="input-clear-start" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">End date</Label>
                <DateInput value={endDate} onChange={setEndDate} testId="input-clear-end" />
              </div>
            </div>

            {/* Scope checkboxes */}
            <div className="space-y-2 border border-border rounded-lg p-3">
              {(Object.keys(SCOPE_LABELS) as HistoryScopeKey[]).map((k) => {
                const info = SCOPE_LABELS[k];
                const count = k === "coachMemory" ? null : counts?.[k as keyof HistoryCounts];
                return (
                  <label
                    key={k}
                    className="flex items-start gap-3 cursor-pointer"
                    data-testid={`scope-${k}`}
                  >
                    <Checkbox
                      checked={scopes[k]}
                      onCheckedChange={() => toggleScope(k)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{info.label}</span>
                        {count != null && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {previewLoading ? "…" : `${count} row${count === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug">{info.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Summary */}
            {anyTableScope && counts && (
              <div className="text-xs text-muted-foreground">
                About to delete <span className="font-semibold text-foreground">{selectedRowTotal}</span> row{selectedRowTotal === 1 ? "" : "s"} across the selected tables
                {startDate || endDate ? ` (${startDate || "beginning"} → ${endDate || "today"})` : " (entire history)"}
                {scopes.coachMemory ? ", plus coach chat history and rolling summary" : ""}.
              </div>
            )}

            {/* Typed confirmation */}
            <div>
              <Label className="text-xs text-muted-foreground">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                disabled={!anyScopeSelected}
                data-testid="input-confirm-delete"
                className="font-mono"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void submit(); }}
              disabled={!anyScopeSelected || confirmText.trim() !== "DELETE" || deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-clear"
            >
              {deleting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Clearing…</>
                : <><Trash2 className="w-4 h-4 mr-2" />Clear now</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
