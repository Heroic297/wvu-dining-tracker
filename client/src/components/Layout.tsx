import { ReactNode, useState, useEffect } from "react";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, UtensilsCrossed, Clock, Target, Settings,
  LogOut, Menu, X, Sun, Moon, Users, Brain, Watch,
} from "lucide-react";
import { cn } from "@/lib/utils";

const OWNER_EMAIL = "owengidusko@gmail.com";

const BASE_NAV = [
  { href: "/",          label: "Dashboard",  icon: LayoutDashboard },
  { href: "/log",       label: "Log Meal",   icon: UtensilsCrossed  },
  { href: "/history",   label: "History",    icon: Clock            },
  { href: "/plan",      label: "Diet Plan",  icon: Target           },
  { href: "/wearables", label: "Wearables",  icon: Watch            },
  { href: "/coach",     label: "Coach",      icon: Brain            },
  { href: "/settings",  label: "Settings",   icon: Settings         },
];

const OWNER_NAV = [
  { href: "/invites", label: "Invites",   icon: Users            },
];

/** Inline "M" mark — two overlapping peaks, emerald on dark pill */
function LogoMark({ size = 32 }: { size?: number }) {
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
  const { user, logout } = useAuth();
  const isOwner = user?.email === OWNER_EMAIL;
  const navItems = isOwner ? [...BASE_NAV, ...OWNER_NAV] : BASE_NAV;
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── Theme toggle ────────────────────────────────────────────
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
  }, [dark]);

  const handleLogout = async () => {
    try { await api.logout(); } catch {}
    logout();
  };

  // ── Nav content shared by desktop + mobile ───────────────────
  const NavContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <LogoMark size={30} />
        <span className="text-[15px] font-bold tracking-tight text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          Macro
        </span>
      </div>

      {/* User chip */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest mb-0.5">Signed in as</p>
        <p className="text-xs font-medium text-foreground truncate">{user?.displayName ?? user?.email}</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = loc === href || (href !== "/" && loc.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
            >
              <Icon className={cn("w-[17px] h-[17px] flex-shrink-0", active && "text-primary")} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="px-3 py-3 border-t border-border space-y-0.5">
        {/* Theme toggle */}
        <button
          onClick={() => setDark(!dark)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all w-full"
          data-testid="button-theme-toggle"
        >
          {dark
            ? <Sun className="w-[17px] h-[17px]" />
            : <Moon className="w-[17px] h-[17px]" />}
          {dark ? "Light mode" : "Dark mode"}
        </button>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          data-testid="button-logout"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all w-full"
        >
          <LogOut className="w-[17px] h-[17px]" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 border-r border-border bg-card flex-shrink-0">
        <NavContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-60 bg-card border-r border-border shadow-2xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <LogoMark size={26} />
                <span className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>Macro</span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavContent />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <LogoMark size={26} />
            <span className="font-bold text-sm" style={{ fontFamily: "var(--font-display)" }}>Macro</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDark(!dark)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              {dark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              data-testid="button-mobile-menu"
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
