import { describe, expect, it } from "vitest";

import {
  buildCandidateEvidence,
  buildCandidateFingerprint,
  buildJobEvidenceInput,
  buildJobFingerprint,
} from "@/lib/ai/artifacts/fingerprints";
import { fingerprintAIInput } from "@/lib/ai/runtime/fingerprint";

function candidateInput() {
  return {
    profile: {
      id: 1,
      summary: "  Backend engineer   building distributed systems. ",
      preferredCountry: " India ",
      preferredCity: " Bengaluru ",
    },
    skills: [
      { name: " TypeScript ", category: "Backend" },
      { name: "typescript", category: "backend" },
      { name: "Node.js", category: null },
    ],
    experience: [{
      title: "Senior Engineer",
      company: "Example Co",
      location: "Bengaluru",
      startDate: "2022-01",
      endDate: null,
      description: "Built reliable services.",
      highlights: '["Reduced latency", "Led migrations"]',
    }],
    education: [{
      institution: "Example University",
      degree: "B.Tech",
      field: "Computer Science",
      startDate: "2016",
      endDate: "2020",
      gpa: "8.5",
      honors: "Dean's list",
    }],
    preferences: {
      acceptedLocationTypes: ["Remote", "hybrid", "remote"],
      acceptedEmploymentTypes: ["Full-Time"],
    },
  };
}

function jobInput() {
  return {
    title: "Senior Backend Engineer",
    description: "Build distributed TypeScript services.",
    location: "Bengaluru, India",
    locationType: "Hybrid",
    seniorityLevel: "Senior",
    department: "Engineering",
    employmentType: "Full-Time",
    salary: "INR 40-50L",
    status: "new",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("artifact fingerprints", () => {
  it("canonicalizes candidate evidence independent of ordering and formatting", () => {
    const first = candidateInput();
    const second = candidateInput();
    second.skills.reverse();
    second.preferences.acceptedLocationTypes.reverse();
    second.profile.summary = "Backend engineer building distributed systems.";

    const firstEvidence = buildCandidateEvidence(first);
    const secondEvidence = buildCandidateEvidence(second);

    expect(firstEvidence.skills).toHaveLength(2);
    expect(buildCandidateFingerprint(firstEvidence)).toBe(
      buildCandidateFingerprint(secondEvidence)
    );
  });

  it("totally orders same-key experience and education records", () => {
    const first = candidateInput();
    first.experience.push({
      ...first.experience[0],
      description: "A different role description",
    });
    first.education.push({
      ...first.education[0],
      honors: "Graduated with distinction",
    });
    const second = structuredClone(first);
    second.experience.reverse();
    second.education.reverse();

    expect(buildCandidateFingerprint(buildCandidateEvidence(first))).toBe(
      buildCandidateFingerprint(buildCandidateEvidence(second))
    );
  });

  it("canonicalizes object keys with locale-independent code-point ordering", () => {
    expect(fingerprintAIInput({ "ä": 1, z: 2, a: 3 })).toBe(
      fingerprintAIInput({ a: 3, z: 2, "ä": 1 })
    );
  });

  it("normalizes canonically equivalent Unicode text", () => {
    const composed = candidateInput();
    composed.profile.summary = "Café platform engineer";
    const decomposed = candidateInput();
    decomposed.profile.summary = "Cafe\u0301 platform engineer";

    expect(buildCandidateFingerprint(buildCandidateEvidence(composed))).toBe(
      buildCandidateFingerprint(buildCandidateEvidence(decomposed))
    );
  });

  it("changes candidate fingerprints only for matching-relevant mutations", () => {
    const base = candidateInput();
    const baseFingerprint = buildCandidateFingerprint(buildCandidateEvidence(base));
    const summaryChanged = candidateInput();
    summaryChanged.profile.summary = "Security-focused backend engineer.";
    const preferenceChanged = candidateInput();
    preferenceChanged.preferences.acceptedEmploymentTypes = ["contract"];
    const educationChanged = candidateInput();
    educationChanged.education[0].honors = "Graduated with distinction";
    const nonMatchingFieldChanged = {
      ...candidateInput(),
      profile: {
        ...candidateInput().profile,
        name: "A different display name",
        email: "different@example.com",
        updatedAt: new Date(),
      },
    };

    expect(buildCandidateFingerprint(buildCandidateEvidence(summaryChanged))).not.toBe(
      baseFingerprint
    );
    expect(buildCandidateFingerprint(buildCandidateEvidence(preferenceChanged))).not.toBe(
      baseFingerprint
    );
    expect(buildCandidateFingerprint(buildCandidateEvidence(educationChanged))).not.toBe(
      baseFingerprint
    );
    expect(buildCandidateFingerprint(buildCandidateEvidence(nonMatchingFieldChanged))).toBe(
      baseFingerprint
    );
  });

  it("changes job fingerprints for content changes but not workflow status", () => {
    const base = jobInput();
    const baseFingerprint = buildJobFingerprint(buildJobEvidenceInput(base));
    const descriptionChanged = { ...jobInput(), description: "Build Rust services." };
    const statusOnlyChanged = {
      ...jobInput(),
      status: "applied",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    };

    expect(buildJobFingerprint(buildJobEvidenceInput(descriptionChanged))).not.toBe(
      baseFingerprint
    );
    expect(buildJobFingerprint(buildJobEvidenceInput(statusOnlyChanged))).toBe(
      baseFingerprint
    );
  });
});
