import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export interface MatchBreakdownValue {
  mustHaveSkills?: number | null;
  preferredSkills?: number | null;
  experience?: number | null;
  seniority?: number | null;
  location?: number | null;
  employmentType?: number | null;
  legacy?: number;
}

interface MatchBreakdownProps {
  breakdown: MatchBreakdownValue | null;
  confidence: number | null;
  stale: boolean;
}

const COMPONENT_LABELS: Array<[keyof MatchBreakdownValue, string]> = [
  ["mustHaveSkills", "Must-have skills"],
  ["preferredSkills", "Preferred skills"],
  ["experience", "Experience"],
  ["seniority", "Seniority"],
  ["location", "Location"],
  ["employmentType", "Employment type"],
];

export function MatchBreakdown({ breakdown, confidence, stale }: MatchBreakdownProps) {
  const available = COMPONENT_LABELS.filter(([key]) => breakdown?.[key] != null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {confidence !== null && (
          <Badge variant="outline" className="border-border text-muted-foreground">
            {Math.round(confidence * 100)}% confidence
          </Badge>
        )}
        {stale && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
            <AlertTriangle className="mr-1 h-3 w-3" />
            Refresh required
          </Badge>
        )}
      </div>

      {stale && (
        <p className="text-sm text-amber-200/80">
          Your profile, preferences, job details, or scoring policy changed after this result.
          The previous evidence is shown for context but is not used for ranking.
        </p>
      )}

      {available.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
      )}
    </div>
  );
}
