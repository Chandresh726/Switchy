import { describe, expect, it } from "vitest";

import type { ResumeData } from "@/lib/ai/resume/contracts";
import {
  resumeSectionApplyBodySchema,
  type ProfileResponse,
} from "@/lib/api/contracts/profile";
import {
  buildEducationResumeReview,
  buildExperienceResumeReview,
  buildResumeReview,
  buildSkillsResumeReview,
} from "@/lib/profile/resume-review";

describe("resume profile review", () => {
  it("classifies profile and child records as additions, updates, or unchanged", () => {
    const profile: NonNullable<ProfileResponse> = {
      id: 1,
      name: "Alex Rivera",
      email: "old@example.com",
      phone: null,
      location: "Austin",
      preferredCountry: null,
      preferredCity: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      resumePath: null,
      summary: "Original summary",
      createdAt: null,
      updatedAt: null,
      skills: [
        { id: 1, profileId: 1, name: "TypeScript", category: "frontend" },
      ],
      experience: [{
        id: 2,
        profileId: 1,
        company: "Acme",
        title: "Engineer",
        location: "Austin",
        startDate: "2024-01",
        endDate: null,
        description: "Original role",
        highlights: null,
      }],
      education: [{
        id: 3,
        profileId: 1,
        institution: "Example University",
        degree: "BS",
        field: "Computer Science",
        startDate: "2018-08",
        endDate: "2022-05",
        gpa: null,
        honors: null,
      }],
      resumes: [],
    };
    const resume: ResumeData = {
      name: "Alex Rivera",
      email: "new@example.com",
      location: "Austin",
      summary: "Updated summary",
      skills: [
        { name: "typescript", category: "backend" },
        { name: "React", category: "frontend" },
      ],
      experience: [
        {
          company: "Acme",
          title: "Engineer",
          startDate: "2024-01",
          location: "Remote",
          description: "Updated role",
        },
        {
          company: "Beta",
          title: "Senior Engineer",
          startDate: "2026-01",
        },
      ],
      education: [{
        institution: "Example University",
        degree: "BS",
        field: "Computer Science",
        startDate: "2018-08",
        endDate: "2022-05",
        honors: "Dean's List",
      }],
    };

    const review = buildResumeReview(profile, resume);

    expect(review.profile.changedFields).toEqual([
      "Email",
      "Professional summary",
    ]);
    expect(review.skills.changes.map(({ kind, value }) => [kind, value.name])).toEqual([
      ["update", "typescript"],
      ["add", "React"],
    ]);
    expect(review.experience.changes.map(({ kind, value }) => [kind, value.company])).toEqual([
      ["update", "Acme"],
      ["add", "Beta"],
    ]);
    expect(review.education.changes).toMatchObject([{
      kind: "update",
      currentId: 3,
      changedFields: ["Honors"],
    }]);
  });

  it("deduplicates repeated extracted records and leaves matching records unchanged", () => {
    const skillReview = buildSkillsResumeReview(
      [{ id: 1, profileId: 1, name: "TypeScript", category: "frontend" }],
      [
        { name: "TypeScript", category: "frontend" },
        { name: " typescript ", category: "backend" },
      ]
    );
    expect(skillReview).toMatchObject({
      changes: [],
      unchangedCount: 1,
      duplicateCount: 1,
    });

    const experienceReview = buildExperienceResumeReview(
      [{
        id: 1,
        profileId: 1,
        company: "Acme",
        title: "Engineer",
        location: "Remote",
        startDate: "Jan 2024",
        endDate: null,
        description: "Built it",
        highlights: null,
      }],
      [
        {
          company: " Acme ",
          title: "Engineer",
          location: "Remote",
          startDate: "2024-01",
          endDate: null,
          description: "Built it",
        },
        {
          company: "acme",
          title: " engineer ",
          startDate: "2024-01",
        },
      ]
    );
    expect(experienceReview).toMatchObject({
      changes: [{
        kind: "update",
        currentId: 1,
        changedFields: ["Start date"],
      }],
      unchangedCount: 0,
      duplicateCount: 1,
    });

    const educationReview = buildEducationResumeReview(
      [{
        id: 1,
        profileId: 1,
        institution: "Example University",
        degree: "BS",
        field: null,
        startDate: null,
        endDate: null,
        gpa: null,
        honors: null,
      }],
      [
        { institution: "Example University", degree: "BS" },
        { institution: " example university ", degree: " bs " },
      ]
    );
    expect(educationReview).toMatchObject({
      changes: [],
      unchangedCount: 1,
      duplicateCount: 1,
    });
  });

  it("normalizes missing education dates before applying an update", () => {
    const review = buildEducationResumeReview(
      [{
        id: 1,
        profileId: 1,
        institution: "Example University",
        degree: "BS",
        field: null,
        startDate: "",
        endDate: null,
        gpa: null,
        honors: null,
      }],
      [{
        institution: "Example University",
        degree: "BS",
        honors: "Dean's List",
      }]
    );

    expect(review.changes).toMatchObject([{
      kind: "update",
      value: {
        startDate: null,
        honors: "Dean's List",
      },
    }]);
    expect(resumeSectionApplyBodySchema.safeParse({
      section: "education",
      profileId: 1,
      items: review.changes.map(({ value }) => value),
    }).success).toBe(true);
  });

  it("skips extracted records that exceed persisted field limits", () => {
    const skillsReview = buildSkillsResumeReview([], [
      { name: "TypeScript", category: "c".repeat(201) },
      { name: "TypeScript", category: "other" },
      { name: "s".repeat(201), category: "other" },
    ]);
    const experienceReview = buildExperienceResumeReview([], [{
      company: "c".repeat(301),
      title: "Engineer",
      startDate: "2024-01",
    }]);
    const educationReview = buildEducationResumeReview([], [{
      institution: "u".repeat(301),
      degree: "BS",
    }]);

    expect(skillsReview).toMatchObject({
      changes: [{ kind: "add", value: { name: "TypeScript", category: "other" } }],
      duplicateCount: 0,
      invalidCount: 2,
    });
    expect(experienceReview).toMatchObject({ changes: [], invalidCount: 1 });
    expect(educationReview).toMatchObject({ changes: [], invalidCount: 1 });
  });
});
