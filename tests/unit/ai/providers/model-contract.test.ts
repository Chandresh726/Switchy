import { describe, expect, it } from "vitest";

import { ProviderModelDefinitionSchema } from "@/lib/ai/providers/model-contract";

const model = {
  modelId: "example/model",
  label: "Example",
  description: "",
  supportsReasoning: true,
  reasoningControl: { kind: "effort", options: [{ value: "future_v1" }], defaultValue: "future_v1" },
  supportedReasoningEfforts: ["future_v1"],
  defaultReasoningEffort: "future_v1",
};

describe("shared provider model contract", () => {
  it("preserves provider-native reasoning values", () => {
    expect(ProviderModelDefinitionSchema.parse(model)).toEqual(model);
  });

  it("rejects defaults absent from the advertised options even when compatibility fields agree", () => {
    expect(ProviderModelDefinitionSchema.safeParse({
      ...model,
      reasoningControl: { ...model.reasoningControl, defaultValue: "unadvertised" },
      defaultReasoningEffort: "unadvertised",
    }).success).toBe(false);
  });

  it("rejects compatibility fields that disagree with the canonical control", () => {
    expect(ProviderModelDefinitionSchema.safeParse({ ...model, supportedReasoningEfforts: ["other"] }).success).toBe(false);
  });
});
