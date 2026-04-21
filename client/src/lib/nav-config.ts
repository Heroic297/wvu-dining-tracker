import { Home, UtensilsCrossed, Dumbbell, Camera, Activity, MessageCircle, CalendarDays, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavTab {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresPhysique?: boolean;
}

export const PRIMARY_TABS: NavTab[] = [
  { href: "/",          label: "Home",    icon: Home            },
  { href: "/log",       label: "Log",     icon: UtensilsCrossed },
  { href: "/train",     label: "Train",   icon: Dumbbell        },
  { href: "/physique",  label: "Physique",icon: Camera,           requiresPhysique: true },
  { href: "/wearables", label: "Health",  icon: Activity        },
  { href: "/coach",     label: "Coach",   icon: MessageCircle   },
];

export const SECONDARY_TABS: NavTab[] = [
  { href: "/history",  label: "History",  icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings     },
];
