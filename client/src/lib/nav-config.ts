import { Home, UtensilsCrossed, Dumbbell, MessageCircle, CalendarDays, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavTab {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const PRIMARY_TABS: NavTab[] = [
  { href: "/",           label: "Home",      icon: Home            },
  { href: "/nutrition",  label: "Nutrition", icon: UtensilsCrossed },
  { href: "/training",   label: "Training",  icon: Dumbbell        },
  { href: "/coach",      label: "Coach",     icon: MessageCircle   },
];

export const SECONDARY_TABS: NavTab[] = [
  { href: "/history",  label: "History",  icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings     },
];
