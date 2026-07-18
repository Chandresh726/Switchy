import { z } from "zod";

import { positiveIntegerIdSchema } from "./common";
import { jobStatusSchema } from "./jobs";

export const companyPlatformSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "eightfold",
  "servicenow",
  "zwayam",
  "mynexthire",
  "uber",
  "google",
  "atlassian",
  "rippling",
  "visa",
  "nutanix",
  "custom",
]);

export const companyIdParamsSchema = z.object({ id: positiveIntegerIdSchema });

const optionalPlatformSchema = z
  .union([companyPlatformSchema, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

export const companyCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2_000),
  logoUrl: z.string().trim().url().max(2_000).nullable().optional().or(z.literal("")),
  notes: z.string().max(20_000).nullable().optional().or(z.literal("")),
  platform: optionalPlatformSchema,
  boardToken: z.string().trim().max(1_000).nullable().optional().or(z.literal("")),
});
const companyBulkInputSchema = z.array(companyCreateBodySchema).max(500);
export const companyImportBodySchema = z.union([companyCreateBodySchema, companyBulkInputSchema]);
export const companySyncBodySchema = companyBulkInputSchema;

export const companyReplaceBodySchema = companyCreateBodySchema.extend({
  isActive: z.boolean().optional(),
});

export const companyPatchBodySchema = companyReplaceBodySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one company field is required"
);

export const companyIdsBodySchema = z.object({
  companyIds: z.array(positiveIntegerIdSchema).min(1).max(500),
});
export const companyBulkActiveBodySchema = companyIdsBodySchema.extend({ isActive: z.boolean() });

const dateValueSchema = z.iso.datetime().nullable();
const requiredDateValueSchema = z.iso.datetime();

export const companyWriteResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  careersUrl: z.string(),
  logoUrl: z.string().nullable(),
  notes: z.string().nullable(),
  platform: z.string().nullable(),
  boardToken: z.string().nullable(),
  isActive: z.boolean(),
  lastScrapedAt: dateValueSchema,
  createdAt: requiredDateValueSchema,
  updatedAt: dateValueSchema,
});

export const companiesResponseSchema = z.array(companyWriteResponseSchema);

export const companyImportResponseSchema = z.union([
  companyWriteResponseSchema,
  z.array(companyWriteResponseSchema),
]);

export const companyDeleteResponseSchema = z.object({
  success: z.boolean(),
  deletedJobs: z.number().int().nonnegative().optional(),
  deletedPeople: z.number().int().nonnegative().optional(),
}).passthrough();

export const companyJobsDeleteResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number().int().nonnegative(),
  message: z.string(),
});

export const companyRefreshResponseSchema = z.object({
  success: z.boolean(),
  sessionId: z.string(),
  totalCompanies: z.number().int().nonnegative(),
  refreshedCompanies: z.number().int().nonnegative(),
  skippedCompanies: z.number().int().nonnegative(),
  totalJobsFound: z.number().int().nonnegative(),
  totalJobsAdded: z.number().int().nonnegative(),
  totalJobsFiltered: z.number().int().nonnegative(),
  failedCompanies: z.number().int().nonnegative(),
  message: z.string(),
});

const companyJobSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  status: jobStatusSchema,
  matchScore: z.number().nullable(),
  matchLegacy: z.boolean().optional(),
  location: z.string().nullable(),
  locationType: z.string().nullable(),
  discoveredAt: dateValueSchema,
  viewedAt: dateValueSchema,
});

const companyPersonSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  fullName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  profileUrl: z.string(),
  email: z.string().nullable(),
  position: z.string().nullable(),
  connectedOn: dateValueSchema,
  isStarred: z.boolean(),
  notes: z.string().nullable(),
  roleTag: z.string().nullable(),
  roleTagSource: z.string().nullable(),
  lastSeenAt: requiredDateValueSchema,
  createdAt: dateValueSchema,
  updatedAt: dateValueSchema,
  isRecruiter: z.boolean(),
});

export const companyOverviewResponseSchema = z.object({
  company: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    careersUrl: z.string(),
    logoUrl: z.string().nullable(),
    notes: z.string().nullable(),
    platform: z.string().nullable(),
    canScrapeJobs: z.boolean(),
    isActive: z.boolean(),
    lastScrapedAt: dateValueSchema,
  }),
  stats: z.object({
    openJobs: z.number().int().nonnegative(),
    highMatchJobs: z.number().int().nonnegative(),
    mappedPeople: z.number().int().nonnegative(),
    starredPeople: z.number().int().nonnegative(),
    statusCounts: z.object({
      new: z.number().int().nonnegative(),
      viewed: z.number().int().nonnegative(),
      interested: z.number().int().nonnegative(),
      applied: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      archived: z.number().int().nonnegative(),
    }),
    jobsDiscoveredLast7Days: z.number().int().nonnegative(),
    lastJobDiscoveredAt: dateValueSchema,
  }),
  jobs: z.array(companyJobSchema),
  topMatches: z.array(companyJobSchema),
  people: z.array(companyPersonSchema),
  activity: z.object({
    scrapeLogs: z.array(z.object({
      id: z.number().int().positive(),
      status: z.string(),
      triggerSource: z.string().nullable(),
      jobsFound: z.number().nullable(),
      jobsAdded: z.number().nullable(),
      startedAt: dateValueSchema,
      completedAt: dateValueSchema,
    })),
    matchSessions: z.array(z.object({
      id: z.string(),
      status: z.string(),
      triggerSource: z.string(),
      jobsTotal: z.number().nullable(),
      jobsCompleted: z.number().nullable(),
      jobsSucceeded: z.number().nullable(),
      jobsFailed: z.number().nullable(),
      startedAt: dateValueSchema,
      completedAt: dateValueSchema,
    })),
  }),
});

export const companyBulkJobsResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number().int().nonnegative(),
  message: z.string(),
});
export const companyBulkDeleteResponseSchema = z.object({
  success: z.boolean(),
  deletedCompanies: z.number().int().nonnegative(),
  deletedJobs: z.number().int().nonnegative(),
  message: z.string(),
});
export const companyBulkUpdateResponseSchema = z.object({
  success: z.boolean(),
  updated: z.number().int().nonnegative(),
  message: z.string(),
});

export type Company = z.infer<typeof companyWriteResponseSchema>;
export type CompaniesResponse = z.infer<typeof companiesResponseSchema>;
export type CompanyOverviewResponse = z.infer<typeof companyOverviewResponseSchema>;
export type CompanyOverview = CompanyOverviewResponse["company"];
export type CompanyStats = CompanyOverviewResponse["stats"];
export type CompanyJob = CompanyOverviewResponse["jobs"][number];
export type CompanyPerson = CompanyOverviewResponse["people"][number];
export type CompanyActivity = CompanyOverviewResponse["activity"];
