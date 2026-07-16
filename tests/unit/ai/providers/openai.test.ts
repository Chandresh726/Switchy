import { describe, expect, it } from "vitest";

import { OpenAIProvider } from "@/lib/ai/providers/openai";

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider();

  it("does not guess reasoning options when the model catalog has no effort list", () => {
    expect(
      provider.getGenerationOptions(
        { modelId: "gpt-5.2", reasoningEffort: "high" },
        {}
      )
    ).toBeUndefined();
  });

  it("omits reasoning options for every direct OpenAI model", () => {
    expect(
      provider.getGenerationOptions(
        { modelId: "gpt-4.1", reasoningEffort: "high" },
        {}
      )
    ).toBeUndefined();
  });
});
