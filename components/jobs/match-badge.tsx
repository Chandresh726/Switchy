"use client";

import { cn } from "@/lib/utils";

interface MatchBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function MatchBadge({ score, size = "md", showLabel = false }: MatchBadgeProps) {
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

  const getScoreColor = (score: number) => {
    if (score >= 75) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    if (score >= 60) return "bg-green-500/10 text-green-400 border-green-500/30";
    if (score >= 45) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
    if (score >= 30) return "bg-orange-500/10 text-orange-400 border-orange-500/30";
    return "bg-red-500/10 text-red-400 border-red-500/30";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 75) return "Strong";
    if (score >= 60) return "Good";
    if (score >= 45) return "Moderate";
    if (score >= 30) return "Fair";
    return "Weak";
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded border font-medium",
        getScoreColor(score),
        size === "sm" && "h-5 px-1.5 text-[10px]",
        size === "md" && "h-6 px-2 text-xs",
        size === "lg" && "h-8 px-3 text-sm"
      )}
    >
      {Math.round(score)}%{showLabel && ` ${getScoreLabel(score)}`}
    </span>
  );
}
