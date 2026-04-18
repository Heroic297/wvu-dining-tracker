import { ReactNode } from "react";
import { Link } from "wouter";
import { Settings } from "lucide-react";
import { useHashLocation } from "wouter/use-hash-location";
import { cn } from "@/lib/utils";
import TopNav from "./TopNav";
import BottomTabBar from "./BottomTabBar";
import { useAuth } from "@/contexts/AuthContext";

function LogoMark({ size = 26 }: { size?: number }) {
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

export default function Layout({ children }: { children: ReactNode }) {
  const [loc] = useHashLocation();
  const { user } = useAuth();
  const initials = (user?.displayName ?? user?.email ?? "?")[0].toUpperCase();

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Desktop top nav */}
      <TopNav />

      {/* Mobile top status bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="font-bold text-sm" style={{ fontFamily: "var(--font-display)" }}>
            Macro
          </span>
        </div>
        <Link
          href="/settings"
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-150 text-xs font-bold",
            loc.startsWith("/settings")
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          aria-label="Settings"
        >
          {initials}
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <BottomTabBar />
    </div>
  );
}
