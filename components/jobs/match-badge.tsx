"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type MatchBand =
  | "high"
  | "good"
  | "possible"
  | "stretch"
  | "low"
  | "insufficient_evidence";

interface MatchBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  band?: MatchBand | null;
}

export function MatchBadge({
  score,
  size = "md",
  showLabel = false,
  band = null,
}: MatchBadgeProps) {
  if (score === null || score === undefined) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded border border-border bg-muted text-muted-foreground",
          size === "sm" && "h-5 px-1.5 text-[10px]",
          size === "md" && "h-6 px-2 text-xs",
          size === "lg" && "h-8 px-3 text-sm"
        )}
      >
        {showLabel ? "Not scored" : "—"}
      </span>
    );
  }

  const resolvedBand: MatchBand = band ?? (
    score >= 85 ? "high" :
    score >= 70 ? "good" :
    score >= 55 ? "possible" :
    score >= 40 ? "stretch" :
    "low"
  );
  const getVariant = (): "default" | "secondary" | "outline" | "destructive" => {
    if (resolvedBand === "high") return "default";
    if (resolvedBand === "good") return "secondary";
    if (resolvedBand === "low") return "destructive";
    return "outline";
  };

  const getScoreLabel = () => {
    if (resolvedBand === "insufficient_evidence") return "More evidence needed";
    if (resolvedBand === "high") return "High match";
    if (resolvedBand === "good") return "Good match";
    if (resolvedBand === "possible") return "Possible match";
    if (resolvedBand === "stretch") return "Stretch match";
    return "Low match";
  };

  return (
    <Badge
      variant={getVariant()}
      className={cn(
        "font-medium",
        size === "sm" && "h-5 px-1.5 text-[10px]",
        size === "md" && "h-6 px-2 text-xs",
        size === "lg" && "h-8 px-3 text-sm"
      )}
    >
      {Math.round(score)}{showLabel && `/100 · ${getScoreLabel()}`}
    </Badge>
  );
}
