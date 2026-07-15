import { describe, expect, it } from "vitest";

import { preserveWritingGenerationError } from "@/lib/ai/writing/errors";
import { AIError } from "@/lib/ai/shared/errors";

describe("writing error compatibility", () => {
  it("preserves the established public message for exhausted quality retries", () => {
    const normalized = preserveWritingGenerationError(
      new AIError({
        type: "generation_failed",
        message: "Generated output failed the capability quality gate",
      })
    );

    expect(normalized).toMatchObject({
      type: "quality_gate",
      message: "Generated content quality was too low. Please try again.",
      retryable: false,
    });
  });

  it("does not rewrite unrelated provider failures", () => {
    const original = new Error("provider unavailable");

    expect(preserveWritingGenerationError(original)).toBe(original);
  });
});
