import { z } from "zod";

const initializationStateSchema = z.enum(["pending", "ready", "failed"]);

export const livenessResponseSchema = z.object({ status: z.literal("live") });

export const readinessResponseSchema = z.object({
  ready: z.boolean(),
  databaseAvailable: z.boolean(),
  schedulerInitialization: initializationStateSchema,
  queueRecovery: initializationStateSchema,
});

export const runtimeHealthResponseSchema = z.object({
  databaseAvailable: z.boolean(),
  schedulerInitialization: initializationStateSchema,
  queueRecovery: initializationStateSchema,
  lastSuccessfulRecoveryAt: z.string().nullable(),
  lastSuccessfulDispatchAt: z.string().nullable(),
  oldestQueuedWorkAgeMs: z.number().nonnegative().nullable(),
  expiredLeaseCount: z.number().int().nonnegative(),
  lastError: z.object({
    subsystem: z.enum(["database", "scheduler", "queue", "matcher"]),
    code: z.string(),
    at: z.string(),
  }).nullable(),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type RuntimeHealthResponse = z.infer<typeof runtimeHealthResponseSchema>;
