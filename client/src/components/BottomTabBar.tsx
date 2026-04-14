import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Home, UtensilsCrossed, Dumbbell, Camera, Activity, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

export default function BottomTabBar() {
  const [loc] = useHashLocation();
  const { user } = useAuth();

  const showPhysique = user?.enablePhysiqueTracking === true;

  const TABS = [
    { href: "/",          label: "Home",   icon: Home             },
    { href: "/log",       label: "Log",    icon: UtensilsCrossed  },
    { href: "/train",     label: "Train",  icon: Dumbbell         },
    ...(showPhysique ? [{ href: "/physique", label: "Physique", icon: Camera }] : []),
    { href: "/wearables", label: "Health", icon: Activity         },
    { href: "/coach",     label: "Coach",  icon: MessageCircle    },
  ];

  const hasSixTabs = TABS.length === 6;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-border bg-slate-950/95 backdrop-blur-md safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/"
            ? loc === "/"
            : loc.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 rounded-lg transition-colors duration-150",
                active
                  ? "text-emerald-400"
                  : "text-muted-foreground"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-10 h-7 rounded-full transition-colors duration-150",
                  active && "bg-emerald-500/10"
                )}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className={cn(
                "font-medium leading-tight",
                hasSixTabs ? "text-[10px]" : "text-[10px]"
              )}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
