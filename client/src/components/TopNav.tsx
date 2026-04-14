import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Home, UtensilsCrossed, Activity, MessageCircle, Settings, CalendarDays, Dumbbell, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

/** Inline "M" mark — two overlapping peaks, emerald on dark pill */
function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Macro logo"
    >
      <rect width="32" height="32" rx="7" fill="hsl(var(--primary))" opacity="0.15" />
      <path
        d="M5 22V11l5.5 7.5L16 11l5.5 7.5L27 11v11"
        stroke="hsl(var(--primary))"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TopNav() {
  const [loc] = useHashLocation();
  const { user } = useAuth();
  const showPhysique = user?.enablePhysiqueTracking === true;

  const PRIMARY_TABS = [
    { href: "/",          label: "Home",   icon: Home             },
    { href: "/log",       label: "Log",    icon: UtensilsCrossed  },
    { href: "/train",     label: "Train",  icon: Dumbbell         },
    ...(showPhysique ? [{ href: "/physique", label: "Physique", icon: Camera }] : []),
    { href: "/wearables", label: "Health", icon: Activity         },
    { href: "/coach",     label: "Coach",  icon: MessageCircle    },
  ];

  return (
    <header className="hidden md:flex items-center h-14 border-b border-border bg-slate-950/80 backdrop-blur-md px-4 gap-6 flex-shrink-0">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2 mr-2">
        <LogoMark />
        <span
          className="text-[15px] font-bold tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Macro
        </span>
      </Link>

      {/* Primary tabs */}
      <nav className="flex items-center gap-1">
        {PRIMARY_TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/"
            ? loc === "/"
            : loc.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Secondary icons */}
      <div className="flex items-center gap-1">
        <Link
          href="/history"
          className={cn(
            "flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150",
            loc.startsWith("/history")
              ? "bg-emerald-500/10 text-emerald-400"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
          title="History"
        >
          <CalendarDays className="w-[18px] h-[18px]" />
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150",
            loc.startsWith("/settings")
              ? "bg-emerald-500/10 text-emerald-400"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
          title="Settings"
        >
          <Settings className="w-[18px] h-[18px]" />
        </Link>
      </div>
    </header>
  );
}
