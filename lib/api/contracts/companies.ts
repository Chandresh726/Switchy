import { z } from "zod";

import { positiveIntegerIdSchema } from "./common";

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
const companyBulkInputSchema = z.array(z.unknown()).max(500).transform((items) =>
  items.flatMap((item) => {
    const parsed = companyCreateBodySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  })
);
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

const dateValueSchema = z.string().nullable();

export const companySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  careersUrl: z.string(),
  logoUrl: z.string().nullable(),
  notes: z.string().nullable(),
  platform: z.string().nullable(),
  boardToken: z.string().nullable(),
  isActive: z.boolean(),
  lastScrapedAt: dateValueSchema,
  createdAt: z.string(),
  updatedAt: dateValueSchema,
});

export const companiesResponseSchema = z.array(companySchema);

export const companyWriteResponseSchema = companySchema;
export const companyImportResponseSchema = z.union([companySchema, z.array(companySchema)]);

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
  status: z.string(),
  matchScore: z.number().nullable(),
  matchLegacy: z.boolean().optional(),
  location: z.string().nullable(),
  locationType: z.string().nullable(),
  discoveredAt: z.string().nullable(),
  viewedAt: z.string().nullable(),
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
  connectedOn: z.string().nullable(),
  isStarred: z.boolean(),
  notes: z.string().nullable(),
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
    lastScrapedAt: z.string().nullable(),
  }),
  stats: z.object({
    openJobs: z.number().int().nonnegative(),
    highMatchJobs: z.number().int().nonnegative(),
    mappedPeople: z.number().int().nonnegative(),
    starredPeople: z.number().int().nonnegative(),
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
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
    })),
    matchSessions: z.array(z.object({
      id: z.string(),
      status: z.string(),
      triggerSource: z.string(),
      jobsTotal: z.number().nullable(),
      jobsCompleted: z.number().nullable(),
      jobsSucceeded: z.number().nullable(),
      jobsFailed: z.number().nullable(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
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
