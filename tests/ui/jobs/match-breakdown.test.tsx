import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchBadge } from "@/components/jobs/match-badge";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";

describe("semantic match presentation", () => {
  it("shows fit, evidence coverage, requirement reasoning, and blocking constraints", () => {
    render(
      <MatchBreakdown
        breakdown={{ roleFit: 82, requirementFit: 78, experience: 95 }}
        confidence={0.81}
        stale={false}
        summary="Good role fit with transferable cloud experience."
        band="good"
        evidenceCoverage={0.75}
        extractionConfidence={0.9}
        constraints={[{
          type: "location",
          status: "conflict",
          severity: "blocking",
          message: "Onsite role is outside the candidate's location.",
        }]}
        requirementAssessments={[{
          requirementId: "requirement:1",
          status: "transferable_match",
          confidence: 0.84,
          evidenceReferences: ["experience:0"],
          rationale: "Azure cloud experience: AWS evidence supports transferable cloud competency.",
          requirementType: "technology",
          requirementImportance: "important",
          requirementText: "Cloud platform experience",
        }]}
      />
    );

    expect(screen.getByText("Good match")).toBeTruthy();
    expect(screen.getByText("75% evidence coverage")).toBeTruthy();
    expect(screen.getByText("location constraint")).toBeTruthy();
    expect(screen.getByText("Transferable")).toBeTruthy();
    expect(screen.getByText("important")).toBeTruthy();
    expect(screen.getByText("technology")).toBeTruthy();
    expect(screen.getByText("Cloud platform experience")).toBeTruthy();
    expect(screen.getByText(/AWS evidence supports transferable cloud competency/)).toBeTruthy();
  });

  it("presents the compatibility score using the original percentage badge", () => {
    render(<MatchBadge score={82} band="good" showLabel />);

    expect(screen.getByText("82% Strong")).toBeTruthy();
    expect(screen.queryByText("82/100 · Good match")).toBeNull();
  });

  it("does not present low-evidence scores as a strong match", () => {
    render(<MatchBadge score={82} band="insufficient_evidence" showLabel />);

    expect(screen.getByText("82% More evidence needed")).toBeTruthy();
  });
});
