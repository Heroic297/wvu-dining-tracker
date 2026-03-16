import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/contexts/AuthContext";
import { api, lbsToKg, kgToLbs } from "@/lib/api";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Loader2, Dumbbell, Activity, Scale } from "lucide-react";

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

  // Wearable status
  const { data: wearableStatus } = useQuery<{ fitbit: boolean; garmin: boolean }>({
    queryKey: ["/api/wearables/status"],
    queryFn: async () => {
      const res = await fetch("/api/wearables/status", { headers: { Authorization: `Bearer ${getToken()}` } });
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
        targetWeightKg: targetWeightLbs ? lbsToKg(parseFloat(targetWeightLbs)) : null,
        targetDate: targetDate || null,
        burnMode,
        trainingDays,
        meetDate: meetDate || null,
        enableWaterCut,
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
    } catch {
      toast({ title: `${source} not configured`, description: "Set FITBIT_CLIENT_ID or GARMIN_CLIENT_ID env vars", variant: "destructive" });
    }
  };

  const disconnectWearable = async (source: string) => {
    await api.disconnectWearable(source);
    queryClient.invalidateQueries({ queryKey: ["/api/wearables/status"] });
    toast({ title: `${source} disconnected` });
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
          <Input type="date" value={weightDate} onChange={(e) => setWeightDate(e.target.value)} className="flex-1" data-testid="input-weight-date" />
          <Button onClick={logWeight} disabled={!weightLbs} data-testid="button-log-weight">Save</Button>
        </div>
      </section>

      {/* Body stats */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-4">
        <h2 className="font-semibold">Body stats &amp; TDEE</h2>

        <div className="grid grid-cols-2 gap-3">
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
            <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} data-testid="input-dob" />
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

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Calorie burn source</p>
            <p className="text-xs text-muted-foreground">Use wearable data or TDEE estimate</p>
          </div>
          <Select value={burnMode} onValueChange={setBurnMode}>
            <SelectTrigger className="w-36" data-testid="select-burn-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tdee">TDEE estimate</SelectItem>
              <SelectItem value="wearable">Wearable data</SelectItem>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target weight (lbs)</Label>
              <Input type="number" value={targetWeightLbs} onChange={(e) => setTargetWeightLbs(e.target.value)} data-testid="input-target-weight" />
            </div>
            <div className="space-y-1.5">
              <Label>Target date</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} data-testid="input-target-date" />
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
              <Input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} data-testid="input-meet-date" />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="watercut" checked={enableWaterCut}
                onCheckedChange={setEnableWaterCut}
                data-testid="switch-watercut"
              />
              <Label htmlFor="watercut" className="cursor-pointer">Enable 7-day water cut plan</Label>
            </div>
          </>
        )}
      </section>

      {/* Wearables */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Dumbbell className="w-4 h-4 text-primary" />Wearable integrations</h2>
        <p className="text-xs text-muted-foreground">Connect your device to use real activity data for calorie targets.</p>

        {[
          { key: "fitbit", label: "Fitbit" },
          { key: "garmin", label: "Garmin Connect" },
        ].map(({ key, label }) => {
          const connected = wearableStatus?.[key as "fitbit" | "garmin"];
          return (
            <div key={key} className="flex items-center justify-between py-2 border-t border-border first:border-0">
              <div className="flex items-center gap-2">
                {connected
                  ? <CheckCircle className="w-4 h-4 text-green-400" />
                  : <XCircle className="w-4 h-4 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{connected ? "Connected" : "Not connected"}</p>
                </div>
              </div>
              {connected ? (
                <Button
                  variant="outline" size="sm"
                  onClick={() => disconnectWearable(key)}
                  data-testid={`button-disconnect-${key}`}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => connectWearable(key as any)}
                  data-testid={`button-connect-${key}`}
                >
                  Connect
                </Button>
              )}
            </div>
          );
        })}
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
