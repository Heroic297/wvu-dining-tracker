import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { PRIMARY_TABS, SECONDARY_TABS } from "@/lib/nav-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const { user, logout } = useAuth();
  const showPhysique = user?.enablePhysiqueTracking === true;

  const visibleTabs = PRIMARY_TABS.filter(t => !t.requiresPhysique || showPhysique);
  const initials = (user?.displayName ?? user?.email ?? "?")[0].toUpperCase();

  return (
    <header className="hidden md:flex items-center h-14 border-b border-border bg-slate-950/80 backdrop-blur-md px-4 gap-6 flex-shrink-0">
      {/* Brand */}
      <Link
        href="/"
        onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
        className="flex items-center gap-2 mr-2"
      >
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
        {visibleTabs.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? loc === "/" : loc.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              style={active ? { filter: "drop-shadow(0 0 6px hsl(var(--primary) / 0.5))" } : undefined}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Secondary links */}
      <div className="flex items-center gap-1">
        {SECONDARY_TABS.map(({ href, label, icon: Icon }) => {
          const active = loc.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
              className={cn(
                "flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              title={label}
            >
              <Icon className="w-[18px] h-[18px]" />
            </Link>
          );
        })}

        {/* Profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-1 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary hover:bg-primary/30 transition-colors"
              aria-label="User menu"
            >
              {initials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">
              {user?.displayName ?? user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={logout}
              className="text-destructive focus:text-destructive cursor-pointer"
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
