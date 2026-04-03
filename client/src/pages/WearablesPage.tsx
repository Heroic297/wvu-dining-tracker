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
  syncedAt: string | null;
}

interface GarminStatus {
  connected: boolean;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  summary: GarminSummary | null;
}

export default function WearablesPage() {
  const { toast } = useToast();
  const [garminEmail, setGarminEmail] = useState("");
  const [garminPassword, setGarminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { data: garminData, isLoading, refetch } = useQuery<GarminStatus>({
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
      // Wait a moment for background sync to start, then refetch
      setTimeout(() => refetch(), 3000);
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
      refetch();
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
      refetch();
    },
  });

  const connected = garminData?.connected ?? false;
  const summary = garminData?.summary;
  const status = garminData?.status ?? "disconnected";

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

  const fmtTime = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    }) + " ET";
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

        {/* Login form — shown when disconnected or error */}
        {(!connected || status === "error") && (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Sign in with your Garmin Connect credentials to sync your wearable data.
              Your credentials are used once to establish a session — they are not stored.
              Only the encrypted session token is saved for future syncs.
            </p>
            <div className="space-y-2">
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

            {/* Body Battery */}
            {summary.bodyBatteryHigh != null && (
              <DataCard
                icon={Battery} label="Body Battery" iconColor="text-cyan-400"
                value={`${summary.bodyBatteryLow ?? "?"} – ${summary.bodyBatteryHigh}`}
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

          {/* Sleep breakdown */}
          {summary.sleepDurationMin != null && (summary.deepSleepMin || summary.remSleepMin || summary.lightSleepMin) && (
            <section className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-400" />
                Sleep Breakdown
              </h3>
              <div className="flex gap-2">
                {[
                  { label: "Deep", min: summary.deepSleepMin, color: "bg-indigo-500" },
                  { label: "Light", min: summary.lightSleepMin, color: "bg-blue-400" },
                  { label: "REM", min: summary.remSleepMin, color: "bg-purple-400" },
                  { label: "Awake", min: summary.awakeSleepMin, color: "bg-orange-300" },
                ].filter(s => s.min && s.min > 0).map(stage => (
                  <div key={stage.label} className="flex-1 text-center">
                    <div className={`h-2 rounded-full ${stage.color} mb-1`} />
                    <p className="text-xs font-medium">{stage.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.floor((stage.min ?? 0) / 60)}h {(stage.min ?? 0) % 60}m
                    </p>
                  </div>
                ))}
              </div>
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
