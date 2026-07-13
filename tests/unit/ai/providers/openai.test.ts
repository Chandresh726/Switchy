import { describe, expect, it } from "vitest";

import { OpenAIProvider } from "@/lib/ai/providers/openai";

describe("OpenAIProvider", () => {
  const provider = new OpenAIProvider();

  it("disables reasoning summaries when reasoning effort is enabled", () => {
    expect(
      provider.getGenerationOptions(
        { modelId: "gpt-5.2", reasoningEffort: "high" },
        {}
      )
    ).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "high",
          reasoningSummary: null,
        },
      },
    });
  });

  it("omits reasoning options for unsupported models", () => {
    expect(
      provider.getGenerationOptions(
        { modelId: "gpt-4.1", reasoningEffort: "high" },
        {}
      )
    ).toBeUndefined();
  });
});
