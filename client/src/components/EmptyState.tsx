import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export default function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn("surface-card p-10 flex flex-col items-center text-center gap-3", className)}>
      {Icon && <Icon className="w-10 h-10 text-slate-600" strokeWidth={1.5} />}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-300">{title}</p>
        {body && <p className="text-xs text-slate-500 leading-relaxed max-w-[22ch] mx-auto">{body}</p>}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick} className="mt-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white border-0 shadow-[0_0_12px_hsl(158_64%_42%/0.3)]">
          {action.label}
        </Button>
      )}
    </div>
  );
}
