import { Activity } from "lucide-react";

export default function WearablesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-100">Health &amp; Wearables</h1>
        </div>

        <div className="surface-card p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-800 text-slate-300">
            <Activity className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-100">Coming soon</h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            We're rebuilding the Apple Health integration with a simpler, more reliable setup
            flow. It'll be back in a future update. Thanks for your patience.
          </p>
          <p className="text-xs text-slate-600 pt-2">
            Questions? Reach out via the Settings &rarr; Support link.
          </p>
        </div>
      </div>
    </div>
  );
}
