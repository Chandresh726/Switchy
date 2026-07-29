import { Fragment } from "react";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StatusConfig } from "@/lib/utils/status-config";

/**
 * Coloured bar down the leading edge of a session card. The parent must be
 * `relative` and `overflow-hidden`.
 */
export function StatusRail({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", className)} />
  );
}

export function statusPillClass(config: StatusConfig): string {
  return cn("border-transparent", config.color, config.bgColor);
}

interface StatusPillProps {
  label: string;
  className?: string;
  icon?: LucideIcon;
  spin?: boolean;
}

export function StatusPill({ label, className, icon: Icon, spin }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
        className
      )}
    >
      {Icon && <Icon className={cn("h-3.5 w-3.5", spin && "animate-spin")} />}
      {label}
    </span>
  );
}

interface SessionStatProps {
  value: string | number | null | undefined;
  label: string;
  icon?: LucideIcon;
  accent?: "emerald" | "red";
  size?: "sm" | "md";
}

const ACCENT_CLASS = {
  emerald: "text-emerald-400",
  red: "text-red-400",
} as const;

/**
 * A single `icon value label` triple, the unit every session summary row is
 * built from. Accent colour only applies to non-zero values so an empty run
 * stays visually quiet.
 */
export function SessionStat({
  value,
  label,
  icon: Icon,
  accent,
  size = "sm",
}: SessionStatProps) {
  const isEmpty = value === null || value === undefined;
  const accentClass = accent && !isEmpty && Boolean(value) ? ACCENT_CLASS[accent] : undefined;

  return (
    <span className="flex items-center gap-1.5">
      {Icon && (
        <Icon
          className={cn(
            "shrink-0 text-muted-foreground",
            size === "md" ? "h-4 w-4" : "h-3.5 w-3.5",
            accentClass
          )}
        />
      )}
      <span
        className={cn(
          "font-semibold leading-none tabular-nums text-foreground",
          size === "md" ? "text-lg" : "text-sm",
          isEmpty && "text-muted-foreground",
          accentClass
        )}
      >
        {isEmpty ? "—" : value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

interface MetaLineProps {
  items: Array<string | null | undefined | false>;
  className?: string;
}

/** Dot-separated secondary text under a session or company title. */
export function MetaLine({ items, className }: MetaLineProps) {
  const visible = items.filter((item): item is string => Boolean(item));
  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground",
        className
      )}
    >
      {visible.map((item, index) => (
        <Fragment key={`${index}-${item}`}>
          {index > 0 && (
            <span aria-hidden className="text-border">
              &middot;
            </span>
          )}
          <span>{item}</span>
        </Fragment>
      ))}
    </div>
  );
}
