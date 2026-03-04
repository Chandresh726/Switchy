import { describe, expect, it } from "vitest";

import { getContentTypeLabel, getWorkspacePath, getWorkspacePathWithVariant } from "@/lib/ai/writing/workspace/routes";

describe("workspace routes", () => {
  it("returns type-specific workspace paths", () => {
    expect(getWorkspacePath(10, "referral")).toBe("/jobs/10/referral-send");
    expect(getWorkspacePath(10, "cover_letter")).toBe("/jobs/10/cover-letter");
    expect(getWorkspacePath(10, "recruiter_follow_up")).toBe("/jobs/10/recruiter-follow-up");
  });

  it("appends variant query when provided", () => {
    expect(getWorkspacePathWithVariant(15, "referral", 99)).toBe("/jobs/15/referral-send?variantId=99");
    expect(getWorkspacePathWithVariant(15, "cover_letter")).toBe("/jobs/15/cover-letter");
  });

  it("exposes human-friendly labels", () => {
    expect(getContentTypeLabel("referral")).toBe("Referral Message");
    expect(getContentTypeLabel("cover_letter")).toBe("Cover Letter");
    expect(getContentTypeLabel("recruiter_follow_up")).toBe("Recruiter Follow-up");
  });
});
