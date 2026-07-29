import { z } from "zod";

export const matchSessionParamsSchema = z.object({
  id: z.string().trim().min(1).max(200),
});

export const schedulerStatusResponseSchema = z.object({
  isActive: z.boolean(),
  isRunning: z.boolean(),
  isEnabled: z.boolean(),
  lastRun: z.string().nullable(),
  nextRun: z.string().nullable(),
  cronExpression: z.string(),
  pendingMissedCount: z.number().int().nonnegative(),
  oldestMissedRun: z.string().nullable(),
  latestMissedRun: z.string().nullable(),
});

export const schedulerRecoveryResponseSchema = z.object({
  status: z.enum(["started", "already_running", "not_needed", "disabled"]),
  pendingMissedCount: z.number().int().nonnegative(),
  oldestMissedRun: z.string().nullable(),
  latestMissedRun: z.string().nullable(),
});

export const matchPhaseProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export const matchJobProgressSchema = z.object({
  jobId: z.number().int().positive(),
  jobTitle: z.string(),
  companyName: z.string().nullable(),
  analysisStatus: z.enum(["queued", "analyzing", "ready", "cached", "failed"]),
  matchStatus: z.enum(["blocked", "queued", "matching", "completed", "cached", "failed"]),
  analysisRunId: z.string().nullable().default(null),
  matchRunId: z.string().nullable().default(null),
  errorStage: z.enum(["analysis", "matching"]).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  analysisStartedAt: z.string().nullable(),
  analysisCompletedAt: z.string().nullable(),
  matchStartedAt: z.string().nullable(),
  matchCompletedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export const matchSessionProgressResponseSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  analysis: matchPhaseProgressSchema,
  matching: matchPhaseProgressSchema,
  jobs: z.array(matchJobProgressSchema),
  jobPagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

export type SchedulerStatusResponse = z.infer<typeof schedulerStatusResponseSchema>;
export type MatchPhaseProgress = z.infer<typeof matchPhaseProgressSchema>;
export type MatchJobProgress = z.infer<typeof matchJobProgressSchema>;
export type MatchSessionProgress = z.infer<typeof matchSessionProgressResponseSchema>;
