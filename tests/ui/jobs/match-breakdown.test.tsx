import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchBadge } from "@/components/jobs/match-badge";
import { MatchBreakdown } from "@/components/jobs/match-breakdown";

describe("simplified match presentation", () => {
  it("shows summary, four scores, concise reasoning, and matched skills", () => {
    render(
      <MatchBreakdown
        breakdown={{
          responsibilities: 86,
          skillsAndTechnologies: 80,
          experienceAndSeniority: 84,
          domainFit: 72,
        }}
        stale={false}
        summary="Good role fit with transferable cloud experience."
        reasoning={[{
          type: "match",
          text: "AWS experience transfers directly to the role's cloud responsibilities.",
        }, {
          type: "gap",
          text: "The candidate has less direct experience in this product domain.",
        }]}
        matchedSkills={["TypeScript", "AWS"]}
      />
    );

    expect(screen.getByText("Good role fit with transferable cloud experience.")).toBeTruthy();
    expect(screen.getByText("Responsibilities")).toBeTruthy();
    expect(screen.getByText("Skills & technologies")).toBeTruthy();
    expect(screen.getByText("Experience & seniority")).toBeTruthy();
    expect(screen.getByText("Domain fit")).toBeTruthy();
    expect(screen.getByText("Why this score")).toBeTruthy();
    expect(screen.queryByText("Match")).toBeNull();
    expect(screen.queryByText("Gap")).toBeNull();
    expect(screen.getByText("AWS experience transfers directly to the role's cloud responsibilities.").closest("li")?.className)
      .not.toContain("border");
    expect(screen.getByText("TypeScript")).toBeTruthy();
    expect(screen.queryByText("Skills to Develop")).toBeNull();
    expect(screen.queryByText("Recommendations")).toBeNull();
  });

  it("presents the compatibility score using the original percentage badge", () => {
    render(<MatchBadge score={82} showLabel />);
    expect(screen.getByText("82% Strong")).toBeTruthy();
  });
});
