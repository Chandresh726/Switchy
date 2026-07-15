import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export interface MatchBreakdownValue {
  roleFit?: number | null;
  requirementFit?: number | null;
  preferenceFit?: number | null;
  mustHaveSkills?: number | null;
  preferredSkills?: number | null;
  experience?: number | null;
  seniority?: number | null;
  location?: number | null;
  employmentType?: number | null;
  legacy?: number;
}

type MatchBand =
  | "high"
  | "good"
  | "possible"
  | "stretch"
  | "low"
  | "insufficient_evidence";

interface MatchConstraintValue {
  type: "location" | "authorization" | "license" | "employment" | "management";
  status: "satisfied" | "conflict" | "unknown";
  severity: "blocking" | "preference" | "informational";
  message: string;
}

interface RequirementAssessmentValue {
  requirementId: string;
  status:
    | "direct_match"
    | "equivalent_match"
    | "transferable_match"
    | "partial_match"
    | "missing"
    | "unknown"
    | "not_applicable";
  confidence: number;
  evidenceReferences: string[];
  rationale: string;
  requirementType?: string;
  requirementImportance?: "critical" | "important" | "preferred" | "contextual";
  requirementText?: string;
}

interface MatchBreakdownProps {
  breakdown: MatchBreakdownValue | null;
  confidence: number | null;
  stale: boolean;
  summary?: string;
  band?: MatchBand | null;
  evidenceCoverage?: number | null;
  extractionConfidence?: number | null;
  constraints?: MatchConstraintValue[];
  requirementAssessments?: RequirementAssessmentValue[];
}

const COMPONENT_LABELS: Array<[keyof MatchBreakdownValue, string]> = [
  ["roleFit", "Role fit"],
  ["requirementFit", "Requirements"],
  ["experience", "Experience"],
  ["seniority", "Seniority"],
  ["preferenceFit", "Preferences"],
];

const BAND_LABELS: Record<MatchBand, string> = {
  high: "High match",
  good: "Good match",
  possible: "Possible match",
  stretch: "Stretch match",
  low: "Low match",
  insufficient_evidence: "More evidence needed",
};

const STATUS_LABELS: Record<RequirementAssessmentValue["status"], string> = {
  direct_match: "Direct",
  equivalent_match: "Equivalent",
  transferable_match: "Transferable",
  partial_match: "Partial",
  missing: "Gap",
  unknown: "Unknown",
  not_applicable: "Context only",
};

function RequirementIcon({ status }: { status: RequirementAssessmentValue["status"] }) {
  if (["direct_match", "equivalent_match", "transferable_match"].includes(status)) {
    return <CheckCircle2 aria-hidden="true" className="text-primary" />;
  }
  if (status === "missing") {
    return <XCircle aria-hidden="true" className="text-destructive" />;
  }
  return <CircleHelp aria-hidden="true" className="text-muted-foreground" />;
}

export function MatchBreakdown({
  breakdown,
  confidence,
  stale,
  summary = "",
  band = null,
  evidenceCoverage = null,
  extractionConfidence = null,
  constraints = [],
  requirementAssessments = [],
}: MatchBreakdownProps) {
  const available = COMPONENT_LABELS.filter(([key]) => breakdown?.[key] != null);
  const visibleAssessments = requirementAssessments
    .filter((assessment) => assessment.status !== "not_applicable")
    .sort((left, right) => {
      const priority = { missing: 0, unknown: 1, partial_match: 2 } as const;
      return (priority[left.status as keyof typeof priority] ?? 3) -
        (priority[right.status as keyof typeof priority] ?? 3);
    })
    .slice(0, 12);
  const blockingConstraints = constraints.filter((constraint) =>
    constraint.severity === "blocking" && constraint.status === "conflict"
  );

  return (
    <div className="flex flex-col gap-4">
      {summary && <p className="text-sm leading-relaxed text-foreground">{summary}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {band && <Badge variant="secondary">{BAND_LABELS[band]}</Badge>}
        {confidence !== null && (
          <Badge variant="outline">
            {Math.round(confidence * 100)}% score confidence
          </Badge>
        )}
        {evidenceCoverage !== null && (
          <Badge variant="outline">
            {Math.round(evidenceCoverage * 100)}% evidence coverage
          </Badge>
        )}
        {extractionConfidence !== null && (
          <Badge variant="outline">
            {Math.round(extractionConfidence * 100)}% extraction confidence
          </Badge>
        )}
        {stale && (
          <Badge variant="outline">
            <AlertTriangle data-icon="inline-start" />
            Refresh required
          </Badge>
        )}
      </div>

      {stale && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Match refresh required</AlertTitle>
          <AlertDescription>
            Your profile, preferences, job details, or scoring policy changed after this result.
            The previous evidence is shown for context but is not used for ranking.
          </AlertDescription>
        </Alert>
      )}

      {blockingConstraints.map((constraint) => (
        <Alert key={`${constraint.type}:${constraint.message}`} variant="destructive">
          <AlertTriangle />
          <AlertTitle>{constraint.type} constraint</AlertTitle>
          <AlertDescription>{constraint.message}</AlertDescription>
        </Alert>
      ))}

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

      {constraints.filter((constraint) => !blockingConstraints.includes(constraint)).length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Constraints and preferences</h3>
          <div className="flex flex-wrap gap-2">
            {constraints.filter((constraint) => !blockingConstraints.includes(constraint))
              .map((constraint) => (
                <Badge
                  key={`${constraint.type}:${constraint.message}`}
                  variant={constraint.status === "conflict" ? "outline" : "secondary"}
                >
                  {constraint.message}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {visibleAssessments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Requirement reasoning</h3>
          <div className="grid gap-2">
            {visibleAssessments.map((assessment) => (
              <div
                key={assessment.requirementId}
                className="flex items-start gap-3 rounded-md border border-border bg-background/30 p-3"
              >
                <RequirementIcon status={assessment.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{STATUS_LABELS[assessment.status]}</Badge>
                    {assessment.requirementImportance && (
                      <Badge variant={assessment.requirementImportance === "critical"
                        ? "destructive"
                        : "secondary"}
                      >
                        {assessment.requirementImportance}
                      </Badge>
                    )}
                    {assessment.requirementType && (
                      <Badge variant="outline">
                        {assessment.requirementType.replaceAll("_", " ")}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {Math.round(assessment.confidence * 100)}% confidence
                    </span>
                  </div>
                  {assessment.requirementText && (
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {assessment.requirementText}
                    </p>
                  )}
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {assessment.rationale}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
