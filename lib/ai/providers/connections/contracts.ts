import { z } from "zod";

export const providerConnectionStatusSchema = z.enum([
  "ready", "not_installed", "not_authenticated", "no_models", "incompatible", "error",
]);

export const providerConnectionSnapshotSchema = z.object({
  status: providerConnectionStatusSchema,
  selectable: z.boolean(),
  cliVersion: z.string().max(200).optional(),
  statusMessage: z.string().max(1_000),
  lastCheckedAt: z.string().datetime(),
  isStale: z.boolean().optional(),
});

export type ProviderConnectionSnapshot = z.infer<typeof providerConnectionSnapshotSchema>;
