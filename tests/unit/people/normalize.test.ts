import { describe, expect, it } from "vitest";

import {
  isLinkedInProfileUrl,
  normalizeCompanyName,
  normalizeLinkedInProfileUrl,
  parseConnectedOn,
} from "@/lib/people/normalize";

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

  it("parses connected date", () => {
    const parsed = parseConnectedOn("2024-03-12");
    expect(parsed).not.toBeNull();
  });

  it("validates linkedin profile url", () => {
    expect(isLinkedInProfileUrl("https://www.linkedin.com/in/john-doe")).toBe(true);
    expect(isLinkedInProfileUrl("https://google.com")).toBe(false);
  });
});
