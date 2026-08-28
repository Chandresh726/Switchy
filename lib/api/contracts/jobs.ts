import { z } from "zod";

import {
  JobAnalysisEvidenceSchema,
  MatchBreakdownSchema,
  MatchReasoningPointSchema,
  MatchSourceSchema,
} from "@/lib/ai/artifacts/schemas";
import { JOB_STATUSES } from "@/lib/jobs/status";

export const jobStatusSchema = z.enum(JOB_STATUSES);

const commaSeparated = <T extends z.ZodTypeAny>(item: T, maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" ? value.split(",").filter(Boolean) : value,
    z.array(item).max(maximum)
  );

const isoDateInputSchema = z.union([z.date(), z.iso.datetime()]).transform(
  (value) => typeof value === "string" ? new Date(value) : value
);
const nullableIsoDateSchema = z.iso.datetime().nullable();

export const jobsQuerySchema = z
  .object({
    companyId: z.coerce.number().int().positive().optional(),
    scrapeSessionId: z.string().uuid().optional(),
    companyIds: commaSeparated(z.coerce.number().int().positive(), 100).optional(),
    status: jobStatusSchema.optional(),
    excludeStatus: commaSeparated(jobStatusSchema, 6).optional(),
    minScore: z.coerce.number().min(0).max(100).optional(),
    maxScore: z.coerce.number().min(0).max(100).optional(),
    matchBands: commaSeparated(z.enum(["high", "good"]), 2).optional(),
    locationType: commaSeparated(
      z.enum(["remote", "hybrid", "onsite"]),
      3
    ).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    department: z.string().trim().min(1).max(120).optional(),
    employmentType: z.string().trim().min(1).max(80).optional(),
    seniorityLevel: z.string().trim().min(1).max(80).optional(),
    locationSearch: z.string().trim().min(1).max(120).optional(),
    discoveredSince: isoDateInputSchema.optional(),
    updatedSince: isoDateInputSchema.optional(),
    viewedSince: isoDateInputSchema.optional(),
    appliedSince: isoDateInputSchema.optional(),
    sortBy: z
      .enum([
        "matchScore",
        "discoveredAt",
        "postedDate",
        "updatedAt",
        "viewedAt",
        "appliedAt",
        "companyName",
        "title",
      ])
      .default("matchScore"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
    limit: z.coerce.number().int().positive().max(100).default(25),
  })
  .refine(
    ({ minScore, maxScore }) =>
      minScore === undefined ||
      maxScore === undefined ||
      minScore <= maxScore,
    {
      message: "minScore must be less than or equal to maxScore",
      path: ["minScore"],
    }
  );

export const jobIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const jobResourceUpdateBodySchema = z
  .object({
    status: jobStatusSchema.optional(),
    viewedAt: isoDateInputSchema.optional(),
    appliedAt: isoDateInputSchema.optional(),
  })
  .refine(
    ({ status, viewedAt, appliedAt }) =>
      status !== undefined || viewedAt !== undefined || appliedAt !== undefined,
    { message: "At least one job field must be updated" }
  );

const jobSummarySchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  externalId: z.string().nullable(),
  title: z.string(),
  descriptionFormat: z.enum(["markdown", "plain", "html"]),
  url: z.string(),
  location: z.string().nullable(),
  locationType: z.string().nullable(),
  salary: z.string().nullable(),
  department: z.string().nullable(),
  employmentType: z.string().nullable(),
  seniorityLevel: z.string().nullable(),
  status: jobStatusSchema,
  postedDate: nullableIsoDateSchema,
  discoveredAt: nullableIsoDateSchema,
  updatedAt: nullableIsoDateSchema,
  archivedAt: nullableIsoDateSchema,
  archiveSource: z.string().nullable(),
  viewedAt: nullableIsoDateSchema,
  appliedAt: nullableIsoDateSchema,
  matchScore: z.number().nullable(),
  matchReasons: z.array(z.string()),
  matchedSkills: z.array(z.string()),
  matchResultId: z.string().nullable(),
  matchBreakdown: MatchBreakdownSchema.nullable(),
  matchStale: z.boolean(),
  matchLegacy: z.boolean(),
  matchSummary: z.string(),
  matchReasoning: z.array(MatchReasoningPointSchema),
  matchRunId: z.string().nullable(),
  matchPolicyVersion: z.string().nullable(),
  scoringPolicyVersion: z.string().nullable(),
  company: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    platform: z.string().nullable(),
  }),
}).strict();

const storedJobAnalysisSchema = JobAnalysisEvidenceSchema.extend({
  id: z.string(),
  extractorVersion: z.string(),
  createdAt: z.iso.datetime(),
});

export const jobSchema = jobSummarySchema.extend({
  description: z.string().nullable(),
  matchMetadata: z.object({
    source: MatchSourceSchema,
    createdAt: z.iso.datetime(),
  }).nullable(),
  jobAnalysis: storedJobAnalysisSchema.nullable(),
});

export const jobsResponseSchema = z.object({
  jobs: z.array(jobSummarySchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export const jobUpdateResponseSchema = z.object({
  id: z.number().int().positive(),
  status: jobStatusSchema,
  viewedAt: nullableIsoDateSchema,
  appliedAt: nullableIsoDateSchema,
  archivedAt: nullableIsoDateSchema,
  archiveSource: z.string().nullable(),
  updatedAt: nullableIsoDateSchema,
});

export type JobSummary = z.infer<typeof jobSummarySchema>;
export type JobDetail = z.infer<typeof jobSchema>;
export type JobsResponse = z.infer<typeof jobsResponseSchema>;
export type JobUpdateResponse = z.infer<typeof jobUpdateResponseSchema>;
export type JobUpdateInput = z.output<typeof jobResourceUpdateBodySchema>;
