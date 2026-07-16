import { z } from "zod";

import { MatchBreakdownSchema, MatchReasoningPointSchema } from "@/lib/ai/artifacts/schemas";

export const jobStatusSchema = z.enum([
  "new",
  "viewed",
  "interested",
  "applied",
  "rejected",
  "archived",
]);

const commaSeparated = <T extends z.ZodTypeAny>(item: T, maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" ? value.split(",").filter(Boolean) : value,
    z.array(item).max(maximum)
  );

export const jobsQuerySchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    companyId: z.coerce.number().int().positive().optional(),
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
    sortBy: z
      .enum([
        "matchScore",
        "discoveredAt",
        "postedDate",
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

export const jobUpdateBodySchema = z
  .object({
    id: z.coerce.number().int().positive(),
    status: jobStatusSchema.optional(),
    viewedAt: z.coerce.date().optional(),
    appliedAt: z.coerce.date().optional(),
  })
  .refine(
    ({ status, viewedAt, appliedAt }) =>
      status !== undefined || viewedAt !== undefined || appliedAt !== undefined,
    { message: "At least one job field must be updated" }
  );

export const jobSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  externalId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  descriptionFormat: z.enum(["markdown", "plain", "html"]),
  url: z.string(),
  location: z.string().nullable(),
  locationType: z.string().nullable(),
  salary: z.string().nullable(),
  department: z.string().nullable(),
  employmentType: z.string().nullable(),
  seniorityLevel: z.string().nullable(),
  status: jobStatusSchema,
  postedDate: z.string().nullable(),
  discoveredAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  archiveSource: z.string().nullable(),
  viewedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  matchScore: z.number().nullable(),
  matchReasons: z.string().nullable(),
  matchedSkills: z.string().nullable(),
  matchResultId: z.string().nullable(),
  matchBreakdown: MatchBreakdownSchema.nullable(),
  matchStale: z.boolean(),
  matchLegacy: z.boolean(),
  matchSummary: z.string(),
  matchReasoning: z.array(MatchReasoningPointSchema),
  scoringPolicyVersion: z.string().nullable(),
  company: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    platform: z.string().nullable(),
  }),
}).passthrough();

export const jobsResponseSchema = z.object({
  jobs: z.array(jobSchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export const jobUpdateResponseSchema = z.object({ id: z.number().int().positive() }).passthrough();
