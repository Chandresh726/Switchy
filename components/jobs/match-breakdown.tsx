import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export interface MatchBreakdownValue {
  responsibilities?: number | null;
  skillsAndTechnologies?: number | null;
  experienceAndSeniority?: number | null;
  domainFit?: number | null;
  legacy?: number;
}

export interface MatchReasoningPointValue {
  type: "match" | "gap" | "context";
  text: string;
}

interface MatchBreakdownProps {
  breakdown: MatchBreakdownValue | null;
  stale: boolean;
  summary?: string;
  reasoning?: MatchReasoningPointValue[];
  matchedSkills?: string[];
}

const COMPONENT_LABELS: Array<[keyof MatchBreakdownValue, string]> = [
  ["responsibilities", "Responsibilities"],
  ["skillsAndTechnologies", "Skills & technologies"],
  ["experienceAndSeniority", "Experience & seniority"],
  ["domainFit", "Domain fit"],
];

export function MatchBreakdown({
  breakdown,
  stale,
  summary = "",
  reasoning = [],
  matchedSkills = [],
}: MatchBreakdownProps) {
  const available = COMPONENT_LABELS.filter(([key]) => breakdown?.[key] != null);

  return (
    <div className="flex flex-col gap-5">
      {summary ? (
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>
      ) : null}

      {stale ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Match refresh required</AlertTitle>
          <AlertDescription>
            Your profile, job details, or matching configuration changed after this result.
          </AlertDescription>
        </Alert>
      ) : null}

      {available.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {available.map(([key, label]) => (
            <div key={key} className="rounded-md border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {Math.round(breakdown?.[key] ?? 0)}
                <span className="text-xs font-normal text-muted-foreground">/100</span>
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {reasoning.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Why this score</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            {reasoning.map((point, index) => (
              <li
                key={`${point.type}:${index}:${point.text}`}
              >
                {point.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {matchedSkills.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Matched skills</h3>
          <div className="flex flex-wrap gap-2">
            {matchedSkills.map((skill) => (
              <Badge key={skill} variant="secondary">{skill}</Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
