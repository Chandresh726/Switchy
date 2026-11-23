import { describe, expect, it } from "vitest";

import { openaiProvider } from "@/lib/ai/providers/openai";

describe("OpenAIProvider", () => {
  const provider = openaiProvider;

  it("does not guess reasoning options when the model catalog has no effort list", () => {
    expect(
      provider.getGenerationOptions(
        { modelId: "gpt-5.2", reasoningEffort: "high" },
        {}
      )
    ).toBeUndefined();
  });

});
