"use client";

import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  getMatchScoreBarFillClass,
  getMatchScoreTextClass,
} from "@/components/jobs/match-score-style";
import { cn } from "@/lib/utils";
import type { MatchBreakdown, MatchReasoningPoint } from "@/lib/ai/artifacts/schemas";

interface MatchBreakdownProps {
  breakdown: MatchBreakdown | null;
  summary?: string;
  reasoning?: Array<Pick<MatchReasoningPoint, "type" | "text">>;
  matchedSkills?: string[];
}

export function MatchStaleNote() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-amber-400"
      role="status"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Refresh required
    </span>
  );
}

const COMPONENT_LABELS: Array<[keyof MatchBreakdown, string]> = [
  ["responsibilities", "Responsibilities"],
  ["skillsAndTechnologies", "Skills & technologies"],
  ["experienceAndSeniority", "Experience & seniority"],
  ["domainFit", "Domain fit"],
];

const SKILL_PREVIEW_COUNT = 4;

function CategoryScoreBars({
  scores,
  showDenom = false,
  compact = false,
}: {
  scores: Array<{ key: string; label: string; value: number }>;
  showDenom?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", compact ? "gap-2.5" : "gap-3")}>
      {scores.map(({ key, label, value }) => {
        const rounded = Math.round(value);
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span
                className={cn(
                  "tabular-nums font-medium",
                  getMatchScoreTextClass(rounded)
                )}
              >
                {rounded}
                {showDenom ? (
                  <span className="font-normal text-muted-foreground">/100</span>
                ) : null}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${label} score`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={rounded}
            >
              <div
                className={cn(
                  "h-full transition-[width] duration-300",
                  getMatchScoreBarFillClass(rounded)
                )}
                style={{ width: `${Math.min(100, Math.max(0, rounded))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReasoningList({
  reasoning,
}: {
  reasoning: Array<Pick<MatchReasoningPoint, "type" | "text">>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">Why this score</h3>
      <ul className="flex flex-col gap-2">
        {reasoning.map((point, index) => {
          const Icon =
            point.type === "match"
              ? Check
              : point.type === "gap"
                ? AlertCircle
                : Info;
          return (
            <li
              key={`${point.type}:${index}:${point.text}`}
              className={cn(
                "flex gap-2.5 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground",
                point.type === "match" && "border-l-2 border-l-emerald-500/60",
                point.type === "gap" && "border-l-2 border-l-amber-500/60",
                point.type === "context" && "border-l-2 border-l-muted-foreground/40"
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  point.type === "match" && "text-emerald-400",
                  point.type === "gap" && "text-amber-400",
                  point.type === "context" && "text-muted-foreground"
                )}
                aria-hidden
              />
              <span>{point.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MatchBreakdown({
  breakdown,
  summary = "",
  reasoning = [],
  matchedSkills = [],
}: MatchBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  const scores = COMPONENT_LABELS.filter(([key]) => breakdown?.[key] != null).map(
    ([key, label]) => ({
      key,
      label,
      value: breakdown?.[key] ?? 0,
    })
  );

  const hasDetails = reasoning.length > 0 || matchedSkills.length > SKILL_PREVIEW_COUNT;
  const previewSkills = matchedSkills.slice(0, SKILL_PREVIEW_COUNT);
  const remainingSkillCount = matchedSkills.length - previewSkills.length;

  return (
    <div className="flex flex-col gap-4">
      {summary ? (
        <p
          className={cn(
            "text-sm leading-relaxed text-foreground",
            !expanded && "line-clamp-2"
          )}
        >
          {summary}
        </p>
      ) : null}

      {scores.length > 0 ? (
        <CategoryScoreBars
          scores={scores}
          showDenom={expanded}
          compact={!expanded}
        />
      ) : null}

      {expanded ? (
        <>
          {reasoning.length > 0 ? <ReasoningList reasoning={reasoning} /> : null}

          {matchedSkills.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">Matched skills</h3>
              <div className="flex flex-wrap gap-2">
                {matchedSkills.map((skill) => (
                  <Badge key={skill} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : matchedSkills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {previewSkills.map((skill) => (
            <Badge key={skill} variant="secondary">
              {skill}
            </Badge>
          ))}
          {remainingSkillCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              +{remainingSkillCount} more
            </span>
          ) : null}
        </div>
      ) : null}

      {hasDetails ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? (
            <>
              Hide details
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Show details
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
