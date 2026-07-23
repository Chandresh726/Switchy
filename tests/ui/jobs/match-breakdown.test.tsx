import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MatchBadge } from "@/components/jobs/match-badge";
import {
  MatchBreakdown,
  MatchStaleNote,
} from "@/components/jobs/match-breakdown";

describe("two-level match presentation", () => {
  it("shows summary, category scores, and skill preview by default", () => {
    render(
      <MatchBreakdown
        breakdown={{
          responsibilities: 86,
          skillsAndTechnologies: 80,
          experienceAndSeniority: 84,
          domainFit: 72,
        }}
        summary="Good role fit with transferable cloud experience."
        reasoning={[{
          type: "match",
          text: "AWS experience transfers directly to the role's cloud responsibilities.",
        }, {
          type: "gap",
          text: "The candidate has less direct experience in this product domain.",
        }]}
        matchedSkills={["TypeScript", "AWS", "React", "Node.js", "PostgreSQL"]}
      />
    );

    expect(screen.getByText("Good role fit with transferable cloud experience.")).toBeTruthy();
    expect(screen.getByText("Responsibilities")).toBeTruthy();
    expect(screen.getByText("Skills & technologies")).toBeTruthy();
    expect(screen.getByText("Experience & seniority")).toBeTruthy();
    expect(screen.getByText("Domain fit")).toBeTruthy();
    expect(screen.getByText("TypeScript")).toBeTruthy();
    expect(screen.getByText("AWS")).toBeTruthy();
    expect(screen.getByText("React")).toBeTruthy();
    expect(screen.getByText("Node.js")).toBeTruthy();
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(screen.queryByText("PostgreSQL")).toBeNull();
    expect(screen.queryByText("Why this score")).toBeNull();
    expect(screen.queryByText("Match")).toBeNull();
    expect(screen.queryByText("Gap")).toBeNull();
    expect(screen.queryByText("Skills to Develop")).toBeNull();
    expect(screen.queryByText("Recommendations")).toBeNull();
    expect(screen.getByRole("button", { name: /show details/i })).toBeTruthy();
  });

  it("reveals reasoning and all skills after expanding", async () => {
    const user = userEvent.setup();

    render(
      <MatchBreakdown
        breakdown={{
          responsibilities: 86,
          skillsAndTechnologies: 80,
          experienceAndSeniority: 84,
          domainFit: 72,
        }}
        summary="Good role fit with transferable cloud experience."
        reasoning={[{
          type: "match",
          text: "AWS experience transfers directly to the role's cloud responsibilities.",
        }, {
          type: "gap",
          text: "The candidate has less direct experience in this product domain.",
        }]}
        matchedSkills={["TypeScript", "AWS", "React", "Node.js", "PostgreSQL"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /show details/i }));

    expect(screen.getByText("Why this score")).toBeTruthy();
    expect(
      screen.getByText("AWS experience transfers directly to the role's cloud responsibilities.")
    ).toBeTruthy();
    expect(
      screen.getByText("The candidate has less direct experience in this product domain.")
    ).toBeTruthy();
    expect(screen.getByText("Matched skills")).toBeTruthy();
    expect(screen.getByText("PostgreSQL")).toBeTruthy();
    expect(screen.queryByText("+1 more")).toBeNull();
    expect(screen.queryByText("Match")).toBeNull();
    expect(screen.queryByText("Gap")).toBeNull();
    expect(screen.queryByText("Skills to Develop")).toBeNull();
    expect(screen.queryByText("Recommendations")).toBeNull();
    expect(screen.getByRole("button", { name: /hide details/i })).toBeTruthy();
  });

  it("presents the compatibility score using the original percentage badge", () => {
    render(<MatchBadge score={82} showLabel />);
    expect(screen.getByText("82% Strong")).toBeTruthy();
  });

  it("keeps old analysis visible when stale", () => {
    render(
      <MatchBreakdown
        breakdown={{ responsibilities: 86 }}
        summary="This analysis was calculated before the profile changed."
      />
    );

    expect(screen.getByText("This analysis was calculated before the profile changed."))
      .toBeTruthy();
    expect(screen.getByText("Responsibilities")).toBeTruthy();
  });

  it("shows a compact amber refresh note for the title row", () => {
    render(
      <div className="flex items-center justify-between gap-3">
        <h2>Match Analysis</h2>
        <MatchStaleNote />
      </div>
    );

    expect(screen.getByText("Refresh required")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Match refresh required")).toBeNull();
  });
});
