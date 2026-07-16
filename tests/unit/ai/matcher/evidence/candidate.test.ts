import { describe, expect, it } from "vitest";

import { buildCandidateEvidence } from "@/lib/ai/artifacts";
import {
  buildCandidateEvidenceItems,
  enrichCandidateEvidence,
} from "@/lib/ai/matcher/evidence/candidate";

describe("candidate facts snapshot", () => {
  it("gives the match model complete experience and education facts without subjective inference", () => {
    const evidence = enrichCandidateEvidence(buildCandidateEvidence({
      profile: {
        id: 1,
        summary: "Product engineer",
        preferredCountry: "India",
        preferredCity: "Bengaluru",
      },
      skills: [{ name: "TypeScript", category: "frontend" }],
      experience: [{
        title: "Senior Engineer",
        company: "Example Systems",
        location: "Bengaluru",
        startDate: "2021-01",
        endDate: "2025-06",
        description: "Built product systems",
        highlights: JSON.stringify(["Led a migration"]),
      }],
      education: [{
        institution: "Example University",
        degree: "B.Tech",
        field: "Computer Science",
        startDate: "2016-07",
        endDate: "2020-05",
        gpa: "8.7/10",
        honors: "Distinction",
      }],
    }), new Date("2026-07-01T00:00:00.000Z"));

    const items = buildCandidateEvidenceItems(evidence);
    const experience = items.find((item) => item.id === "experience:0");
    const education = items.find((item) => item.id === "education:0");

    expect(experience?.text).toContain("Company: Example Systems");
    expect(experience?.text).toContain("Location: Bengaluru");
    expect(experience?.text).toContain("Led a migration");
    expect(education?.text).toContain("Dates: 2016-07 to 2020-05");
    expect(education?.text).toContain("GPA: 8.7/10");
    expect(education?.text).toContain("Honors: Distinction");
    expect(evidence.seniorityLevel).toBeNull();
    expect(evidence.domainKeywords).toEqual([]);
  });
});
