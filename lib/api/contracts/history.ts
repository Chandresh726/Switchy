import { z } from "zod";

import { aiRunSummarySchema } from "./ai";
import { matchJobProgressSchema, matchPhaseProgressSchema } from "./runtime";

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});
export const historyIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(200),
});
export const scrapeHistoryQuerySchema = historyQuerySchema.extend({
  limit: historyQuerySchema.shape.limit.default(20),
});
export const historyDetailQuerySchema = z.object({
  logLimit: z.coerce.number().int().positive().max(100).default(50),
  logOffset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  workLimit: z.coerce.number().int().positive().max(100).default(50),
  workOffset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

const paginationResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

const scrapeSessionSchema = z.object({
  id: z.string(),
  triggerSource: z.string(),
  status: z.string(),
  companiesTotal: z.number().int().nullable(),
  companiesCompleted: z.number().int().nullable(),
  totalJobsFound: z.number().int().nullable(),
  totalJobsAdded: z.number().int().nullable(),
  totalJobsFiltered: z.number().int().nullable(),
  totalJobsArchived: z.number().int().nullable(),
  skipReason: z.string().nullable().optional(),
  scheduledForAt: z.coerce.date().nullable().optional(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
}).passthrough();

const matchSessionSchema = z.object({
  id: z.string(),
  triggerSource: z.string(),
  companyId: z.number().int().positive().nullable(),
  companyName: z.string().nullable(),
  status: z.string(),
  jobsTotal: z.number().int().nullable(),
  jobsCompleted: z.number().int().nullable(),
  jobsSucceeded: z.number().int().nullable(),
  jobsFailed: z.number().int().nullable(),
  errorCount: z.number().int().nullable(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
}).passthrough();

export const scrapeHistoryListResponseSchema = z.object({
  sessions: z.array(scrapeSessionSchema),
  pagination: z.object({
    total: paginationResponseSchema.shape.total,
    limit: paginationResponseSchema.shape.limit,
    offset: paginationResponseSchema.shape.offset,
    hasMore: paginationResponseSchema.shape.hasMore,
  }),
  stats: z.object({
    totalSessions: z.number().int().nonnegative(),
    successRate: z.number().nonnegative(),
    avgDuration: z.number().nonnegative(),
  }),
});
export const matchHistoryListResponseSchema = z.object({
  sessions: z.array(matchSessionSchema),
  pagination: paginationResponseSchema,
  stats: z.object({
    totalSessions: z.number().int().nonnegative(),
    successRate: z.number().nonnegative(),
    avgDuration: z.number().nonnegative(),
    totalJobsMatched: z.number().int().nonnegative(),
  }),
}).passthrough();
export const scrapeHistoryDetailResponseSchema = z.object({
  session: scrapeSessionSchema,
  logs: z.array(z.object({
    id: z.number().int().positive(),
    companyId: z.number().int().positive().nullable(),
    companyName: z.string().nullable(),
    companyLogoUrl: z.string().nullable(),
    platform: z.string().nullable(),
    status: z.string(),
    jobsFound: z.number().int().nullable(),
    jobsAdded: z.number().int().nullable(),
    jobsUpdated: z.number().int().nullable(),
    jobsFiltered: z.number().int().nullable(),
    jobsArchived: z.number().int().nullable(),
    errorMessage: z.string().nullable(),
    duration: z.number().nullable(),
    startedAt: z.union([z.string(), z.date()]).nullable(),
    completedAt: z.union([z.string(), z.date()]).nullable(),
    matcherStatus: z.string().nullable(),
    matcherJobsTotal: z.number().int().nullable(),
    matcherJobsCompleted: z.number().int().nullable(),
    matcherDuration: z.number().nullable(),
    matcherErrorCount: z.number().int().nullable(),
    attemptNumber: z.number().int().positive(),
    attemptsTotal: z.number().int().positive(),
    isFinalAttempt: z.boolean(),
  })),
  logPagination: paginationResponseSchema,
  workPagination: paginationResponseSchema,
  hasActiveWork: z.boolean(),
  queueItems: z.array(z.object({
    id: z.string(),
    companyId: z.number().int().positive(),
    companyName: z.string().nullable(),
    companyLogoUrl: z.string().nullable(),
    platform: z.string().nullable(),
    status: z.string(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    availableAt: z.union([z.string(), z.date()]),
    workerId: z.string().nullable(),
    lockedAt: z.union([z.string(), z.date()]).nullable(),
    leaseExpiresAt: z.union([z.string(), z.date()]).nullable(),
    cancelRequested: z.boolean(),
    lastError: z.string().nullable(),
    startedAt: z.union([z.string(), z.date()]).nullable(),
    completedAt: z.union([z.string(), z.date()]).nullable(),
    createdAt: z.union([z.string(), z.date()]),
    updatedAt: z.union([z.string(), z.date()]),
  })),
});
export const matchHistoryDetailResponseSchema = z.object({
  session: matchSessionSchema,
  logs: z.array(z.object({
    id: z.number().int().positive(),
    sessionId: z.string().nullable(),
    jobId: z.number().int().positive().nullable(),
    jobTitle: z.string().nullable(),
    companyName: z.string().nullable(),
    status: z.string(),
    score: z.number().nullable(),
    attemptCount: z.number().int().nullable(),
    errorType: z.string().nullable(),
    errorMessage: z.string().nullable(),
    duration: z.number().nullable(),
    modelUsed: z.string().nullable(),
    completedAt: z.coerce.date().nullable(),
    analysisRunId: z.string().nullable().optional(),
    analysisRun: aiRunSummarySchema.nullable().optional(),
    adjudicationRunId: z.string().nullable().optional(),
    adjudicationRun: aiRunSummarySchema.nullable().optional(),
    matchRunId: z.string().nullable().optional(),
    matchRun: aiRunSummarySchema.nullable().optional(),
  }).passthrough()),
  logPagination: paginationResponseSchema,
  pipeline: z.object({
    analysis: matchPhaseProgressSchema,
    matching: matchPhaseProgressSchema,
    jobs: z.array(matchJobProgressSchema),
    jobPagination: paginationResponseSchema,
  }),
});
export const historyMutationResponseSchema = z.object({ success: z.boolean() }).passthrough();

export type MatchHistoryResponse = z.infer<typeof matchHistoryListResponseSchema>;
export type MatchHistorySession = MatchHistoryResponse["sessions"][number];
export type MatchHistoryDetailResponse = z.infer<typeof matchHistoryDetailResponseSchema>;
export type ScrapeHistoryResponse = z.infer<typeof scrapeHistoryListResponseSchema>;
export type ScrapeHistorySession = ScrapeHistoryResponse["sessions"][number];
export type ScrapeHistoryDetailResponse = z.infer<typeof scrapeHistoryDetailResponseSchema>;
