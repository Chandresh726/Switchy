import { describe, expect, it } from "vitest";

import { validateMatcherConfig } from "@/lib/ai/matcher/config";

describe("matcher configuration validation", () => {
  it("accepts up to three configured attempts", () => {
    expect(validateMatcherConfig({ maxRetries: 3 })).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it("rejects attempt counts outside the persisted range", () => {
    expect(validateMatcherConfig({ maxRetries: 4 })).toMatchObject({
      isValid: false,
      errors: ["Max attempts must be between 1 and 3"],
    });
  });
});
