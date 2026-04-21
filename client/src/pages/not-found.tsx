import { Link } from "wouter";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-10">
      <div className="surface-card surface-card-accent w-full max-w-sm p-8 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center float">
          <Compass
            className="w-7 h-7 text-primary"
            style={{ filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.6))" }}
          />
        </div>

        <div className="space-y-1">
          <p
            className="text-5xl font-extrabold gradient-text leading-none"
            style={{ fontFamily: "var(--font-display)" }}
          >
            404
          </p>
          <h1 className="text-lg font-semibold text-slate-100">Page not found</h1>
          <p className="text-sm text-slate-400">
            That route doesn't exist. Head back to your dashboard.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-[0_0_16px_hsl(158_64%_42%/0.35)] transition-all"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
