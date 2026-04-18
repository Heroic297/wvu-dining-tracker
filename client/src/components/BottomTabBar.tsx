import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { PRIMARY_TABS } from "@/lib/nav-config";

export default function BottomTabBar() {
  const [loc] = useHashLocation();
  const { user } = useAuth();

  const showPhysique = user?.enablePhysiqueTracking === true;
  const tabs = PRIMARY_TABS.filter(t => !t.requiresPhysique || showPhysique);

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-border bg-slate-950/95 backdrop-blur-md safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? loc === "/" : loc.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors duration-150",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-10 h-7 rounded-full transition-all duration-150",
                  active && "bg-primary/15 shadow-[0_0_10px_hsl(var(--primary)/0.4)]"
                )}
                style={active ? { filter: "drop-shadow(0 0 4px hsl(var(--primary) / 0.6))" } : undefined}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-medium leading-tight">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
