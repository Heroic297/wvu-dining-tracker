import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api, lbsToKg, kgToLbs } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/DateInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Loader2, Dumbbell, Activity, Scale, RefreshCw, Droplets, Plus, Trash2 } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
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
  const [enableWaterCut, setEnableWaterCut] = useState(user?.enableWaterCut ?? false);
  const [enableWaterTracking, setEnableWaterTracking] = useState(user?.enableWaterTracking ?? false);
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

  // Wearable status
  const [syncing, setSyncing] = useState<string | null>(null);
  const { data: wearableStatus, refetch: refetchWearableStatus } = useQuery<{ fitbit: boolean; garmin: boolean }>({
    queryKey: ["/api/wearables/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wearables/status");
      if (!res.ok) return { fitbit: false, garmin: false };
      return res.json();
    },
  });

  const saveProfile = async () => {
    setSaving(true);
    try {
      const heightCm = (parseInt(heightFt) * 12 + parseInt(heightIn)) * 2.54;
      const payload: Record<string, any> = {
        sex, dateOfBirth: dob, heightCm, activityLevel, goalType,
        burnMode, trainingDays, enableWaterCut, enableWaterTracking,
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

  const connectWearable = async (source: "fitbit" | "garmin") => {
    try {
      const res = await (source === "fitbit" ? api.getFitbitAuthUrl() : api.getGarminAuthUrl());
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank", "noopener");
      else toast({ title: `${source} not configured`, description: "Set the CLIENT_ID env var in Railway", variant: "destructive" });
    } catch {
      toast({ title: `${source} not configured`, description: "Set GARMIN_CLIENT_ID or FITBIT_CLIENT_ID in Railway env vars", variant: "destructive" });
    }
  };

  const disconnectWearable = async (source: string) => {
    await api.disconnectWearable(source);
    queryClient.invalidateQueries({ queryKey: ["/api/wearables/status"] });
    toast({ title: `${source} disconnected` });
  };

  const syncNow = async (source: "fitbit" | "garmin") => {
    setSyncing(source);
    try {
      await api.syncWearable(source);
      // Invalidate all queries that depend on wearable data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/targets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/weight"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/activity"] }),
      ]);
      toast({ title: `${source === "garmin" ? "Garmin" : "Fitbit"} synced`, description: "Activity and weight updated" });
    } catch {
      toast({ title: "Sync failed", description: "Check your connection and try again", variant: "destructive" });
    } finally {
      setSyncing(null);
    }
  };

  const isPowerlifting = goalType.includes("powerlifting");

  return (
    <div className="p-4 md:p-6 max-w-xl space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>

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

            <div className="flex items-center gap-3">
              <Switch
                id="watercut" checked={enableWaterCut}
                onCheckedChange={setEnableWaterCut}
                data-testid="switch-watercut"
              />
              <Label htmlFor="watercut" className="cursor-pointer">Enable 7-day water cut plan</Label>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="watertracking" checked={enableWaterTracking}
                onCheckedChange={setEnableWaterTracking}
                data-testid="switch-water-tracking"
              />
              <div>
                <Label htmlFor="watertracking" className="cursor-pointer">Enable water intake tracking</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Shows a water tracker on the dashboard. Uses peak week targets when active, otherwise estimates based on your body weight and sex.</p>
              </div>
            </div>

            {enableWaterTracking && (
              <div className="space-y-3 pt-1">
                {/* Unit preference */}
                <div className="flex items-center gap-3">
                  <Droplets className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <Label className="text-xs flex-shrink-0">Display unit</Label>
                  <Select value={waterUnit} onValueChange={(v) => setWaterUnit(v as any)}>
                    <SelectTrigger className="h-8 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oz">oz</SelectItem>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="L">L</SelectItem>
                      <SelectItem value="gal">gal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Saved bottles */}
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

                  {/* Add new bottle */}
                  <div className="flex gap-2 items-end pt-1">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        placeholder="e.g. Hydroflask 32oz"
                        value={newBottleName}
                        onChange={(e) => setNewBottleName(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="w-20 space-y-1">
                      <Label className="text-xs">Size</Label>
                      <Input
                        type="number" min="1"
                        placeholder="32"
                        value={newBottleSize}
                        onChange={(e) => setNewBottleSize(e.target.value)}
                        className="h-8 text-xs"
                      />
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
          </>
        )}
      </section>

      {/* Wearables */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Dumbbell className="w-4 h-4 text-primary" />Wearable integrations</h2>
        <p className="text-xs text-muted-foreground">
          Syncs calorie burn, steps, and morning weight. Weight is used to keep your TDEE targets current automatically.
          Syncs hourly in the background — or hit Sync now after a workout.
        </p>

        {[
          { key: "fitbit", label: "Fitbit", desc: "Activity + weight via Fitbit Web API" },
          { key: "garmin", label: "Garmin Connect", desc: "Activity + body composition via Garmin Health API" },
        ].map(({ key, label, desc }) => {
          const connected = wearableStatus?.[key as "fitbit" | "garmin"];
          const isSyncing = syncing === key;
          return (
            <div key={key} className="py-2 border-t border-border first:border-0 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {connected
                    ? <CheckCircle className="w-4 h-4 text-green-400" />
                    : <XCircle className="w-4 h-4 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{connected ? desc : "Not connected"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {connected && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => syncNow(key as any)}
                      disabled={isSyncing}
                      data-testid={`button-sync-${key}`}
                    >
                      {isSyncing
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                      <span className="ml-1">{isSyncing ? "Syncing..." : "Sync now"}</span>
                    </Button>
                  )}
                  {connected ? (
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => disconnectWearable(key)}
                      data-testid={`button-disconnect-${key}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled
                      data-testid={`button-connect-${key}`}
                      className="opacity-60 cursor-not-allowed"
                    >
                      Connect <span className="ml-1 text-xs font-normal">(coming soon)</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Burn mode toggle — shown when any wearable is connected */}
        {(wearableStatus?.garmin || wearableStatus?.fitbit) && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Calorie target source</p>
                <p className="text-xs text-muted-foreground">Use wearable burn data, or fall back to TDEE formula</p>
              </div>
              <Select value={burnMode} onValueChange={setBurnMode}>
                <SelectTrigger className="w-40" data-testid="select-burn-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wearable">Wearable data</SelectItem>
                  <SelectItem value="tdee">TDEE formula</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              TDEE formula is always used as fallback when wearable data isn't available for a day.
            </p>
          </div>
        )}
      </section>

      <Button onClick={saveProfile} disabled={saving} className="w-full" data-testid="button-save-settings">
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save settings"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
          Created with Perplexity Computer
        </a>
      </p>
    </div>
  );
}
