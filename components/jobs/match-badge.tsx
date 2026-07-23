"use client";

import { cn } from "@/lib/utils";
import {
  getMatchScoreBadgeClass,
  getMatchScoreLabel,
} from "@/components/jobs/match-score-style";

interface MatchBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function MatchBadge({
  score,
  size = "md",
  showLabel = false,
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

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded border font-medium",
        getMatchScoreBadgeClass(score),
        size === "sm" && "h-5 px-1.5 text-[10px]",
        size === "md" && "h-6 px-2 text-xs",
        size === "lg" && "h-8 px-3 text-sm"
      )}
    >
      {Math.round(score)}%{showLabel && ` ${getMatchScoreLabel(score)}`}
    </span>
  );
}
