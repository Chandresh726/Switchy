import { describe, expect, it } from "vitest";

import { applyConnectionPlaceholder, CONNECTION_FIRST_NAME_PLACEHOLDER } from "@/lib/connections/referral-template";

describe("applyConnectionPlaceholder", () => {
  it("replaces placeholder with first name", () => {
    const template = `Hi ${CONNECTION_FIRST_NAME_PLACEHOLDER},\nCan you refer me?`;
    expect(applyConnectionPlaceholder(template, "Jane")).toContain("Hi Jane");
  });

  it("falls back to there when name missing", () => {
    const template = `Hello ${CONNECTION_FIRST_NAME_PLACEHOLDER}`;
    expect(applyConnectionPlaceholder(template, "")).toContain("there");
  });

  it("prepends greeting when placeholder missing", () => {
    const template = "Would you be open to referring me?";
    expect(applyConnectionPlaceholder(template, "Alex").startsWith("Hi Alex")).toBe(true);
  });
});
