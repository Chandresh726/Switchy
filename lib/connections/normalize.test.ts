import { describe, expect, it } from "vitest";

import {
  buildIdentityKey,
  isLinkedInProfileUrl,
  normalizeCompanyName,
  normalizeLinkedInProfileUrl,
  parseConnectedOn,
} from "@/lib/connections/normalize";

describe("connections normalize utilities", () => {
  it("normalizes company names and removes suffixes", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
    expect(normalizeCompanyName("Beta   Labs   LLC")).toBe("beta labs");
  });

  it("normalizes linkedin urls", () => {
    expect(normalizeLinkedInProfileUrl("https://www.linkedin.com/in/Jane-Doe/?trk=abc")).toBe(
      "https://www.linkedin.com/in/jane-doe"
    );
    expect(normalizeLinkedInProfileUrl("https://example.com/user")).toBeNull();
  });

  it("builds identity key using profile url first", () => {
    const key = buildIdentityKey({
      profileUrl: "https://www.linkedin.com/in/test-user/",
      fullName: "Test User",
      companyNormalized: "acme",
      connectedOn: new Date("2024-01-01"),
    });
    expect(key).toBe("profile:https://www.linkedin.com/in/test-user");
  });

  it("falls back to name/company/date identity", () => {
    const key = buildIdentityKey({
      profileUrl: "",
      fullName: "Jane Doe",
      companyNormalized: "acme",
      connectedOn: new Date("2024-02-01"),
    });
    expect(key).toBe("fallback:jane doe|acme|2024-02-01");
  });

  it("parses connected date", () => {
    const parsed = parseConnectedOn("2024-03-12");
    expect(parsed).not.toBeNull();
  });

  it("validates linkedin profile url", () => {
    expect(isLinkedInProfileUrl("https://www.linkedin.com/in/john-doe")).toBe(true);
    expect(isLinkedInProfileUrl("https://google.com")).toBe(false);
  });
});
