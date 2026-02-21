import { describe, expect, it } from "vitest";

import { buildReferralMessage } from "@/lib/connections/message";

describe("buildReferralMessage", () => {
  it("builds professional message with job details", () => {
    const message = buildReferralMessage({
      firstName: "Jane",
      companyName: "Acme",
      jobTitle: "Senior Engineer",
      jobUrl: "https://example.com/job/123",
      tone: "professional",
    });

    expect(message).toContain("Hi Jane");
    expect(message).toContain("Senior Engineer");
    expect(message).toContain("https://example.com/job/123");
  });

  it("builds concise message without job details", () => {
    const message = buildReferralMessage({
      firstName: "Sam",
      companyName: "Beta",
      tone: "concise",
    });

    expect(message).toContain("Hi Sam");
    expect(message).toContain("opportunities at Beta");
  });
});
