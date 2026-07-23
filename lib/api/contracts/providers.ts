import { z } from "zod";

import {
  CUSTOM_API_FORMATS,
  isReasoningEffort,
} from "@/lib/ai/providers/types";

export const providerModelsQuerySchema = z.object({
  refresh: z.enum(["1", "true", "0", "false"]).optional(),
});
export const localCLIStatusQuerySchema = z.object({
  provider: z.enum(["codex_cli", "opencode_cli"]),
});

export const localCLIConnectionStatusSchema = z.enum([
  "ready",
  "not_installed",
  "not_authenticated",
  "no_models",
  "incompatible",
  "error",
]);

export const localCLIStatusResponseSchema = z.object({
  status: localCLIConnectionStatusSchema,
  selectable: z.boolean(),
  cliVersion: z.string().optional(),
  statusMessage: z.string(),
  lastCheckedAt: z.string(),
});

const customHeaderCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.string().max(10_000),
});

const customHeaderPatchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.string().max(10_000).optional(),
});

const customProviderFields = {
  displayName: z.string().trim().min(1).max(100),
  apiFormat: z.enum(CUSTOM_API_FORMATS),
  baseUrl: z.string().trim().min(1).max(2_000),
  manualModelIds: z.array(z.string().max(240)).max(200).default([]),
  reasoningEfforts: z.array(
    z.string().refine(isReasoningEffort, "Invalid reasoning level")
  ).max(100),
};

export const providerPatchBodySchema = z.object({
  apiKey: z.string().max(10_000).nullable().optional(),
  displayName: customProviderFields.displayName.optional(),
  apiFormat: customProviderFields.apiFormat.optional(),
  baseUrl: customProviderFields.baseUrl.optional(),
  headers: z.array(customHeaderPatchSchema).max(50).optional(),
  manualModelIds: z.array(z.string().max(240)).max(200).optional(),
  reasoningEfforts: customProviderFields.reasoningEfforts.optional(),
});
export const providerCreateBodySchema = z.object({
  provider: z.string().trim().min(1).max(100),
  apiKey: z.string().max(10_000).optional(),
  displayName: customProviderFields.displayName.optional(),
  apiFormat: customProviderFields.apiFormat.optional(),
  baseUrl: customProviderFields.baseUrl.optional(),
  headers: z.array(customHeaderCreateSchema).max(50).optional(),
  manualModelIds: customProviderFields.manualModelIds.optional(),
  reasoningEfforts: customProviderFields.reasoningEfforts.optional(),
}).superRefine((value, context) => {
  if (value.provider !== "custom") return;
  for (const key of ["displayName", "apiFormat", "baseUrl"] as const) {
    if (!value[key]) {
      context.addIssue({
        code: "custom",
        message: `${key} is required for a custom provider`,
        path: [key],
      });
    }
  }
});

export type ProviderCreateBody = z.output<typeof providerCreateBodySchema>;
export type ProviderPatchBody = z.output<typeof providerPatchBodySchema>;
