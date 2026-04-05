import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api, kgToLbs } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Watch, RefreshCw, Loader2, CheckCircle, XCircle, AlertCircle,
  Footprints, Moon, Heart, Brain, Battery, Activity, Scale,
  Eye, EyeOff, Unplug,
} from "lucide-react";

interface SleepLevel {
  startGMT: string;
  endGMT: string;
  activityLevel: number;
}

interface GarminSummary {
  date: string;
  totalSteps: number | null;
  caloriesBurned: number | null;
  activeMinutes: number | null;
  sleepDurationMin: number | null;
  deepSleepMin: number | null;
  lightSleepMin: number | null;
  remSleepMin: number | null;
  awakeSleepMin: number | null;
  sleepScore: number | null;
  restingHeartRate: number | null;
  maxHeartRate: number | null;
  avgStress: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  avgOvernightHrv: number | null;
  hrvStatus: string | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  recentActivities: Array<{ name: string; type: string; durationMin: number; calories: number }> | null;
  sleepLevels: SleepLevel[] | null;
  sleepStartLocal: number | null;
  sleepEndLocal: number | null;
  sleepStartGMT: number | null;
  sleepEndGMT: number | null;
  syncedAt: string | null;
}

interface GarminStatus {
  connected: boolean;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  summary: GarminSummary | null;
  tokenType: string;
}

export default function WearablesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [garminEmail, setGarminEmail] = useState("");
  const [garminPassword, setGarminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [diTokenJson, setDiTokenJson] = useState("");
  const [diTokenError, setDiTokenError] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState<"login" | "di-token">("login");

  const { data: garminData, isLoading } = useQuery<GarminStatus>({
    queryKey: ["garmin-status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/garmin/status");
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.garminConnect(garminEmail, garminPassword);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Connection failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Garmin connected", description: "Syncing your data now..." });
      setGarminEmail("");
      setGarminPassword("");
      // Invalidate immediately to show connected status, then again after bg sync
      queryClient.invalidateQueries({ queryKey: ["garmin-status"] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["garmin-status"] }), 5000);
    },
    onError: (err: Error) => {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await api.garminSync();
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sync failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Garmin synced", description: `Updated: ${data.categories?.join(", ") || "no new data"}` });
      // Invalidate garmin status so UI shows fresh data immediately
      queryClient.invalidateQueries({ queryKey: ["garmin-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weight"] });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.garminDisconnect();
      if (!res.ok) throw new Error("Disconnect failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Garmin disconnected" });
      queryClient.invalidateQueries({ queryKey: ["garmin-status"] });
    },
  });

  const diTokenMutation = useMutation({
    mutationFn: async () => {
      setDiTokenError(null);
      let parsed: any;
      try {
        parsed = JSON.parse(diTokenJson);
      } catch {
        throw new Error("Invalid JSON — please paste the full token JSON object");
      }
      if (!parsed.di_token || !parsed.di_refresh_token || !parsed.di_client_id) {
        throw new Error("JSON must contain di_token, di_refresh_token, and di_client_id");
      }
      const res = await api.garminImportDiToken(parsed.di_token, parsed.di_refresh_token, parsed.di_client_id);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "DI token imported", description: "Syncing your Garmin data now..." });
      setDiTokenJson("");
      queryClient.invalidateQueries({ queryKey: ["garmin-status"] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["garmin-status"] }), 5000);
    },
    onError: (err: Error) => {
      setDiTokenError(err.message);
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const connected = garminData?.connected ?? false;
  const summary = garminData?.summary;
  const status = garminData?.status ?? "disconnected";
  const tokenType = garminData?.tokenType ?? "none";

  const StatusIcon = () => {
    switch (status) {
      case "connected": return <CheckCircle className="w-5 h-5 text-green-400" />;
      case "error": return <AlertCircle className="w-5 h-5 text-yellow-400" />;
      default: return <XCircle className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const statusLabel = () => {
    switch (status) {
      case "connected": return "Connected";
      case "error": return "Connection error";
      default: return "Not connected";
    }
  };

  const userTz = localStorage.getItem("macro_timezone") ?? "America/New_York";

  const fmtTime = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: userTz,
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Watch className="w-5 h-5 text-primary" />
          Wearables
        </h1>
        {connected && (
          <Button
            variant="outline" size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            {syncMutation.isPending ? "Syncing..." : "Sync now"}
          </Button>
        )}
      </div>

      {/* Garmin connection card */}
      <section className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
              <Watch className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="font-semibold text-sm">Garmin Connect</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <StatusIcon />
                <span className="text-xs text-muted-foreground">{statusLabel()}</span>
              </div>
            </div>
          </div>
          {connected && (
            <Button
              variant="ghost" size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="text-muted-foreground hover:text-destructive"
            >
              <Unplug className="w-3.5 h-3.5 mr-1" />
              Disconnect
            </Button>
          )}
        </div>

        {/* Last sync time */}
        {connected && garminData?.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            Last synced: {fmtTime(garminData.lastSyncAt)}
          </p>
        )}

        {/* Error message */}
        {status === "error" && garminData?.lastError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-xs text-destructive">{garminData.lastError}</p>
            <p className="text-xs text-muted-foreground mt-1">Try reconnecting below.</p>
          </div>
        )}

        {/* Show DI token badge when connected via DI */}
        {connected && tokenType === "di-token" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-blue-500/10 rounded-lg px-3 py-2">
            <CheckCircle className="w-3.5 h-3.5 text-blue-400" />
            Connected via DI token (direct API)
          </div>
        )}

        {/* Connection options — shown when disconnected or error */}
        {(!connected || status === "error") && (
          <div className="space-y-3 border-t border-border pt-4">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setConnectMode("login")}
                className={`flex-1 text-xs font-medium py-2 px-3 transition-colors ${
                  connectMode === "login"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setConnectMode("di-token")}
                className={`flex-1 text-xs font-medium py-2 px-3 transition-colors ${
                  connectMode === "di-token"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                Use DI Token
              </button>
            </div>

            {/* Login form */}
            {connectMode === "login" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Sign in with your Garmin Connect credentials to sync your wearable data.
                  Your credentials are used once to establish a session — they are not stored.
                  Only the encrypted session token is saved for future syncs.
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Garmin email</Label>
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={garminEmail}
                    onChange={(e) => setGarminEmail(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Garmin password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Password"
                      value={garminPassword}
                      onChange={(e) => setGarminPassword(e.target.value)}
                      className="h-9 text-sm pr-9"
                      onKeyDown={(e) => { if (e.key === "Enter" && garminEmail && garminPassword) connectMutation.mutate(); }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={!garminEmail || !garminPassword || connectMutation.isPending}
                  className="w-full"
                  size="sm"
                >
                  {connectMutation.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Connecting...</>
                    : "Connect Garmin"}
                </Button>
              </div>
            )}

            {/* DI Token import */}
            {connectMode === "di-token" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Paste your Garmin DI token JSON below. This imports your token directly
                  for API access without username/password login.
                </p>
                <Label className="text-xs">DI Token JSON</Label>
                <textarea
                  className="w-full h-28 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={'{\n  "di_token": "...",\n  "di_refresh_token": "...",\n  "di_client_id": "..."\n}'}
                  value={diTokenJson}
                  onChange={(e) => { setDiTokenJson(e.target.value); setDiTokenError(null); }}
                />
                {diTokenError && (
                  <p className="text-xs text-destructive">{diTokenError}</p>
                )}
                <Button
                  onClick={() => diTokenMutation.mutate()}
                  disabled={!diTokenJson.trim() || diTokenMutation.isPending}
                  className="w-full"
                  size="sm"
                >
                  {diTokenMutation.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Importing...</>
                    : "Import DI Token"}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Data summary cards — only shown when connected and data exists */}
      {connected && summary && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Today's Garmin Data
            {summary.syncedAt && (
              <span className="font-normal"> — synced {fmtTime(summary.syncedAt)}</span>
            )}
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Steps */}
            {summary.totalSteps != null && (
              <DataCard
                icon={Footprints} label="Steps" iconColor="text-green-400"
                value={summary.totalSteps.toLocaleString()}
              />
            )}

            {/* Calories */}
            {summary.caloriesBurned != null && (
              <DataCard
                icon={Activity} label="Active Calories" iconColor="text-orange-400"
                value={`${summary.caloriesBurned} kcal`}
              />
            )}

            {/* Sleep */}
            {summary.sleepDurationMin != null && (
              <DataCard
                icon={Moon} label="Sleep" iconColor="text-indigo-400"
                value={`${Math.floor(summary.sleepDurationMin / 60)}h ${summary.sleepDurationMin % 60}m`}
                sub={summary.sleepScore ? `Score: ${summary.sleepScore}/100` : undefined}
              />
            )}

            {/* Heart Rate */}
            {summary.restingHeartRate != null && (
              <DataCard
                icon={Heart} label="Resting HR" iconColor="text-red-400"
                value={`${summary.restingHeartRate} bpm`}
                sub={summary.maxHeartRate ? `Max: ${summary.maxHeartRate}` : undefined}
              />
            )}

            {/* Stress */}
            {summary.avgStress != null && (
              <DataCard
                icon={Brain} label="Avg Stress" iconColor="text-purple-400"
                value={`${summary.avgStress}`}
                sub={summary.avgStress < 30 ? "Low" : summary.avgStress < 50 ? "Medium" : "High"}
              />
            )}

            {/* HRV */}
            {summary.avgOvernightHrv != null && (
              <DataCard
                icon={Heart} label="Overnight HRV" iconColor="text-emerald-400"
                value={`${Math.round(summary.avgOvernightHrv)} ms`}
                sub={summary.hrvStatus ?? undefined}
              />
            )}

            {/* Weight */}
            {summary.weightKg != null && (
              <DataCard
                icon={Scale} label="Garmin Weight" iconColor="text-blue-400"
                value={`${kgToLbs(summary.weightKg)} lbs`}
                sub={summary.bodyFatPct ? `${summary.bodyFatPct}% body fat` : `${summary.weightKg.toFixed(1)} kg`}
              />
            )}
          </div>

          {/* Body Battery gauge */}
          {summary.bodyBatteryHigh != null && (
            <section className="bg-card border border-border rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Battery className="w-4 h-4 text-cyan-400" />
                Body Battery
              </h3>
              <BodyBatteryGauge
                low={summary.bodyBatteryLow ?? 0}
                high={summary.bodyBatteryHigh}
              />
            </section>
          )}

          {/* Sleep breakdown — hypnogram */}
          {summary.sleepDurationMin != null && (summary.deepSleepMin || summary.remSleepMin || summary.lightSleepMin) && (
            <section className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-400" />
                Sleep Breakdown
              </h3>
              <SleepHypnogram
                deepMin={summary.deepSleepMin ?? 0}
                lightMin={summary.lightSleepMin ?? 0}
                remMin={summary.remSleepMin ?? 0}
                awakeMin={summary.awakeSleepMin ?? 0}
                totalMin={summary.sleepDurationMin}
                sleepLevels={summary.sleepLevels ?? undefined}
                sleepStartGMT={summary.sleepStartGMT ?? undefined}
                sleepEndGMT={summary.sleepEndGMT ?? undefined}
                sleepStartLocal={summary.sleepStartLocal ?? undefined}
                sleepEndLocal={summary.sleepEndLocal ?? undefined}
                timezone={userTz}
              />
            </section>
          )}

          {/* Recent activities */}
          {summary.recentActivities && summary.recentActivities.length > 0 && (
            <section className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-orange-400" />
                Recent Activities
              </h3>
              <div className="space-y-2">
                {summary.recentActivities.slice(0, 5).map((act, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                    <span className="text-sm">{act.name}</span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{act.durationMin}m</span>
                      <span>{act.calories} kcal</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Empty state when connected but no data yet */}
      {connected && !summary && !isLoading && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Watch className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No Garmin data yet for today. Hit "Sync now" to pull your latest data.
          </p>
        </div>
      )}

      {/* Info footer */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          Garmin data syncs when you open this page or tap "Sync now". Your session token is encrypted at rest.
        </p>
        <p>
          Weight from Garmin is treated as your current weight unless you log a newer manual weight in Settings.
        </p>
      </div>
    </div>
  );
}

function DataCard({
  icon: Icon,
  label,
  value,
  sub,
  iconColor = "text-primary",
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  iconColor?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-semibold">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// --- Sleep Hypnogram ---


type SleepStage = "awake" | "rem" | "light" | "deep";

const STAGE_COLOR: Record<SleepStage, string> = {
  deep: "#6D28D9",
  light: "#818CF8",
  rem: "#2DD4BF",
  awake: "#F472B6",
};

/** Map Garmin activityLevel to a sleep stage */
function activityLevelToStage(level: number): SleepStage {
  if (level <= 0) return "deep";
  if (level <= 1) return "light";
  if (level <= 2) return "rem";
  return "awake";
}

/** Format duration — drop "0h" prefix when under 1 hour */
function fmtDur(m: number): string {
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

/** Format epoch ms as local clock time: "10PM", "12AM", "4AM" */
function fmtLocalHour(epochMs: number, tz?: string): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  }).replace(/\s/g, "");
}

/** Format epoch ms as "10:07 PM" for tooltip */
function fmtLocalTime(epochMs: number, tz?: string): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
}


function SleepHypnogram({
  deepMin,
  lightMin,
  remMin,
  awakeMin,
  totalMin,
  sleepStartGMT,
  sleepEndGMT,
  sleepStartLocal,
  sleepEndLocal,
  timezone,
}: {
  deepMin: number;
  lightMin: number;
  remMin: number;
  awakeMin: number;
  totalMin: number;
  sleepLevels?: SleepLevel[];
  sleepStartGMT?: number;
  sleepEndGMT?: number;
  sleepStartLocal?: number;
  sleepEndLocal?: number;
  timezone?: string;
}) {
  // Prefer GMT timestamps formatted with user timezone; fall back to Local
  const startEpoch = sleepStartGMT ?? sleepStartLocal;
  const endEpoch = sleepEndGMT ?? sleepEndLocal;
  const tz = sleepStartGMT ? timezone : undefined; // only pass tz when using GMT values
  const stages: { label: string; min: number; stage: SleepStage }[] = [
    { label: "Deep", min: deepMin, stage: "deep" },
    { label: "Light", min: lightMin, stage: "light" },
    { label: "REM", min: remMin, stage: "rem" },
    { label: "Awake", min: awakeMin, stage: "awake" },
  ];

  return (
    <div className="space-y-3">
      {/* Total sleep time */}
      <p className="text-2xl font-bold text-foreground">{fmtDur(totalMin)}</p>

      {/* Stacked bar with flanking times */}
      <div className="flex items-center gap-2">
        {startEpoch != null && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {fmtLocalTime(startEpoch, tz)}
          </span>
        )}
        <div className="flex-1 flex h-3 rounded-full overflow-hidden">
          {stages
            .filter((s) => s.min > 0 && totalMin > 0)
            .map((s) => (
              <div
                key={s.stage}
                style={{
                  width: `${(s.min / totalMin) * 100}%`,
                  backgroundColor: STAGE_COLOR[s.stage],
                }}
              />
            ))}
        </div>
        {endEpoch != null && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {fmtLocalTime(endEpoch, tz)}
          </span>
        )}
      </div>

      {/* Legend row */}
      <div className="flex gap-4 flex-wrap">
        {stages
          .filter((s) => s.min > 0)
          .map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: STAGE_COLOR[s.stage] }}
              />
              <span className="text-xs text-muted-foreground">
                {s.label}: {fmtDur(s.min)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

// --- Body Battery Gauge ---

function BodyBatteryGauge({ low, high }: { low: number; high: number }) {
  const svgW = 320;
  const svgH = 48;
  const barY = 16;
  const barH = 10;
  const barX = 10;
  const barW = svgW - 20;

  const pctLow = Math.max(0, Math.min(100, low)) / 100;
  const pctHigh = Math.max(0, Math.min(100, high)) / 100;

  const lowX = barX + pctLow * barW;
  const highX = barX + pctHigh * barW;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="w-full"
      style={{ height: 52 }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="bbGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="35%" stopColor="#F59E0B" />
          <stop offset="65%" stopColor="#84CC16" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
        <clipPath id="bbClip">
          <rect x={barX} y={barY} width={barW} height={barH} rx={5} />
        </clipPath>
      </defs>

      {/* Background bar (dimmed) */}
      <rect
        x={barX} y={barY} width={barW} height={barH} rx={5}
        fill="url(#bbGrad)" opacity={0.2}
      />

      {/* Highlighted range segment */}
      <rect
        x={lowX} y={barY}
        width={Math.max(0, highX - lowX)} height={barH}
        fill="url(#bbGrad)"
        clipPath="url(#bbClip)"
        rx={0}
      />

      {/* Low marker */}
      <circle cx={lowX} cy={barY + barH / 2} r={5} fill="#1F2937" stroke="#9CA3AF" strokeWidth={1.5} />
      <text x={lowX} y={barY + barH + 14} textAnchor="middle" fontSize="9" fontWeight="600" fill="#F87171">
        {low}
      </text>

      {/* High marker */}
      <circle cx={highX} cy={barY + barH / 2} r={5} fill="#1F2937" stroke="#9CA3AF" strokeWidth={1.5} />
      <text x={highX} y={barY + barH + 14} textAnchor="middle" fontSize="9" fontWeight="600" fill="#4ADE80">
        {high}
      </text>

      {/* Scale labels 0 and 100 */}
      <text x={barX} y={barY - 4} textAnchor="start" fontSize="8" fill="#6B7280">0</text>
      <text x={barX + barW} y={barY - 4} textAnchor="end" fontSize="8" fill="#6B7280">100</text>
    </svg>
  );
}
