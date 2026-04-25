import { useState } from "react";
import { useLocation } from "wouter";
import { Zap, UtensilsCrossed, Droplets, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { todayStr } from "@/lib/api";

export default function QuickLogSheet() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "water" | "weight">("menu");
  const [waterMl, setWaterMl] = useState("");
  const [weightLbs, setWeightLbs] = useState("");

  const today = todayStr();

  const waterMutation = useMutation({
    mutationFn: async (ml: number) => {
      const res = await apiRequest("GET", `/api/dashboard?date=${today}`);
      const dash = await res.json();
      const current = dash?.waterMl ?? 0;
      const r = await apiRequest("POST", "/api/water", { date: today, mlLogged: current + ml });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setOpen(false);
      setView("menu");
      setWaterMl("");
    },
  });

  const weightMutation = useMutation({
    mutationFn: async (lbs: number) => {
      const kg = +(lbs / 2.20462).toFixed(2);
      const r = await apiRequest("POST", "/api/weight", { weightKg: kg, date: today });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weight"] });
      setOpen(false);
      setView("menu");
      setWeightLbs("");
    },
  });

  const handleClose = () => { setOpen(false); setView("menu"); };

  return (
    <Sheet open={open} onOpenChange={v => { setOpen(v); if (!v) setView("menu"); }}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="w-9 h-9 rounded-full border border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
          aria-label="Quick log"
        >
          <Zap className="w-4 h-4" />
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="bg-slate-950 border-t border-white/10 pb-8 rounded-t-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-slate-100">
            {view === "menu" ? "Quick log" : view === "water" ? "Log water" : "Log weight"}
          </SheetTitle>
        </SheetHeader>

        {view === "menu" && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: UtensilsCrossed, label: "Meal",   color: "text-emerald-400", action: () => { handleClose(); navigate("/nutrition?tab=log"); } },
              { icon: Droplets,        label: "Water",  color: "text-sky-400",     action: () => setView("water")  },
              { icon: Scale,           label: "Weight", color: "text-violet-400",  action: () => setView("weight") },
            ].map(({ icon: Icon, label, color, action }) => (
              <button
                key={label}
                onClick={action}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-slate-900 border border-white/5 hover:bg-slate-800 transition-colors"
              >
                <Icon className={`w-6 h-6 ${color}`} />
                <span className="text-sm font-medium text-slate-200">{label}</span>
              </button>
            ))}
          </div>
        )}

        {view === "water" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              {([240, 355, 500, 750] as const).map(ml => (
                <button
                  key={ml}
                  onClick={() => waterMutation.mutate(ml)}
                  disabled={waterMutation.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 border border-sky-400/30 text-sm font-medium text-sky-400 hover:bg-sky-400/10 transition-colors"
                >
                  {ml} ml
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Custom ml"
                value={waterMl}
                onChange={e => setWaterMl(e.target.value)}
                className="bg-slate-900 border-white/10 text-slate-100"
              />
              <Button
                onClick={() => { const ml = parseInt(waterMl, 10); if (ml > 0) waterMutation.mutate(ml); }}
                disabled={!waterMl || waterMutation.isPending}
                className="bg-sky-600 hover:bg-sky-500 text-white border-0"
              >
                Add
              </Button>
            </div>
            <button onClick={() => setView("menu")} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
          </div>
        )}

        {view === "weight" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.1"
                placeholder="Weight in lbs"
                value={weightLbs}
                onChange={e => setWeightLbs(e.target.value)}
                className="bg-slate-900 border-white/10 text-slate-100"
              />
              <Button
                onClick={() => { const lbs = parseFloat(weightLbs); if (lbs > 0) weightMutation.mutate(lbs); }}
                disabled={!weightLbs || weightMutation.isPending}
                className="bg-violet-600 hover:bg-violet-500 text-white border-0"
              >
                Save
              </Button>
            </div>
            <button onClick={() => setView("menu")} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
