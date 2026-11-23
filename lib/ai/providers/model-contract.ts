import { z } from "zod";

import { isReasoningEffort } from "./types";

const boundedDisplayText = (maxLength: number) =>
  z.string().transform((value) => value.slice(0, maxLength));
const ReasoningOptionSchema = z.object({
  value: z.string().refine(isReasoningEffort, "Invalid provider reasoning value"),
  label: boundedDisplayText(120).optional(),
  description: boundedDisplayText(500).optional(),
}).strict();
const ReasoningControlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("effort"),
    options: z.array(ReasoningOptionSchema).min(1).max(100),
    defaultValue: z.string().refine(isReasoningEffort).optional(),
  }).strict(),
  z.object({ kind: z.literal("provider_default") }).strict(),
]).superRefine((control, context) => {
  if (control.kind === "effort" && control.defaultValue &&
      !control.options.some(({ value }) => value === control.defaultValue)) {
    context.addIssue({
      code: "custom",
      message: "The advertised reasoning default must be one of the options",
      path: ["defaultValue"],
    });
  }
});
export const ProviderModelDefinitionSchema = z.object({
  modelId: z.string().min(1).max(240),
  label: boundedDisplayText(240),
  description: boundedDisplayText(2_000),
  supportsReasoning: z.boolean(),
  reasoningControl: ReasoningControlSchema,
  group: boundedDisplayText(240).optional(),
  upstreamProvider: boundedDisplayText(120).optional(),
  supportedReasoningEfforts: z.array(
    z.string().refine(isReasoningEffort)
  ).max(100).optional(),
  defaultReasoningEffort: z.string().refine(isReasoningEffort).optional(),
  isDefault: z.boolean().optional(),
}).strict().superRefine((model, context) => {
  const expectedEfforts = model.reasoningControl.kind === "effort"
    ? model.reasoningControl.options.map(({ value }) => value)
    : [];
  if ((model.supportedReasoningEfforts ?? []).join("\0") !== expectedEfforts.join("\0")) {
    context.addIssue({
      code: "custom",
      message: "Compatibility efforts must match the provider-native control",
      path: ["supportedReasoningEfforts"],
    });
  }
  const expectedDefault = model.reasoningControl.kind === "effort"
    ? model.reasoningControl.defaultValue
    : undefined;
  if (model.defaultReasoningEffort !== expectedDefault) {
    context.addIssue({
      code: "custom",
      message: "Compatibility default must match the provider-native control",
      path: ["defaultReasoningEffort"],
    });
  }
});

export type ProviderModelDefinition = z.infer<typeof ProviderModelDefinitionSchema>;
