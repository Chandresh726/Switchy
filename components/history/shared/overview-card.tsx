import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface OverviewCardProps {
  label: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
  accent?: string;
}

/** Headline metric tile used by the history list pages. */
export function OverviewCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: OverviewCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold leading-none tabular-nums text-foreground",
          accent
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
