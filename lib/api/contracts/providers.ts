import { z } from "zod";

export const providerModelsQuerySchema = z.object({
  refresh: z.enum(["1", "true", "0", "false"]).optional(),
});
export const localCLIStatusQuerySchema = z.object({
  provider: z.enum(["codex_cli", "opencode_cli"]),
});

export const providerPatchBodySchema = z.object({ apiKey: z.string().nullable().optional() });
export const providerCreateBodySchema = z.object({
  provider: z.string().trim().min(1).max(100),
  apiKey: z.string().max(10_000).optional(),
});
export const providerValidationResponseSchema = z.object({
  valid: z.literal(true),
  provider: z.string(),
}).passthrough();
