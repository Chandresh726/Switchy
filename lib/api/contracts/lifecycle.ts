import { z } from "zod";

export const lifecyclePreferencesPatchSchema = z.object({
  startAtLogin: z.boolean().optional(),
  openAtLogin: z.boolean().optional(),
  automaticUpdates: z.boolean().optional(),
}).strict();

export const lifecycleStatusSchema = z.object({
  supported: z.boolean(), startupSupported: z.boolean(),
  preferences: z.object({ startAtLogin: z.boolean(), openAtLogin: z.boolean(),
    automaticUpdates: z.boolean(), running: z.boolean(), port: z.number().int() }),
  update: z.object({ phase: z.enum(["idle", "checking", "available", "downloading", "ready", "waiting", "installing", "failed"]),
    lastCheckedAt: z.string().nullable(), latestVersion: z.string().nullable(),
    failedVersion: z.string().nullable(), downloadedVersion: z.string().nullable().default(null), message: z.string().nullable() }),
});

export const lifecycleActionSchema = z.object({ action: z.enum(["check", "download", "install"]) }).strict();
export const lifecycleHeartbeatSchema = z.object({ id: z.string().uuid() }).strict();

export const lifecycleAcceptedSchema = z.object({ accepted: z.literal(true) });

export const lifecycleHeartbeatResponseSchema = z.object({ version: z.string(), updating: z.boolean(), supported: z.boolean().optional() });
