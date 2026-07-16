import { z } from "zod";

import { positiveIntegerIdSchema } from "./common";

export const peopleSourceSchema = z.enum(["linkedin", "apollo"]);
export const peopleImportModeSchema = z.enum(["merge", "replace"]);
export const personIdParamsSchema = z.object({ id: positiveIntegerIdSchema });

export const peopleListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  companyId: positiveIntegerIdSchema.optional(),
  source: z.enum(["linkedin", "apollo", "manual", "all"]).optional(),
  starred: z.enum(["true", "false"]).optional(),
  active: z.enum(["true", "false", "all"]).optional(),
  unmatched: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  sortBy: z.enum(["lastSeenAt", "fullName", "createdAt", "isStarred"]).default("lastSeenAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const unmatchedCompaniesQuerySchema = z.object({
  summaryOnly: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

export const unmatchedCompanyPeopleQuerySchema = z.object({
  companyNormalized: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

export const unmatchedCompanyPatchBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("map"), companyNormalized: z.string().trim().min(1).max(500), mappedCompanyId: positiveIntegerIdSchema }),
  z.object({ action: z.literal("ignore"), companyNormalized: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("unignore"), companyNormalized: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("refresh") }),
]);

export const personPatchBodySchema = z.object({
  isStarred: z.boolean().optional(),
  notes: z.string().max(2_000).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  mappedCompanyId: positiveIntegerIdSchema.nullable().optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "At least one editable field is required");

export const manualPersonBodySchema = z.object({
  fullName: z.string().trim().min(1).max(300).optional(),
  firstName: z.string().trim().max(150).optional(),
  lastName: z.string().trim().max(150).optional(),
  profileUrl: z.string().trim().max(2_000).optional(),
  email: z.string().trim().email().max(320).optional().or(z.literal("")),
  companyRaw: z.string().trim().max(500).optional(),
  position: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2_000).optional(),
  mappedCompanyId: positiveIntegerIdSchema.nullable().optional(),
});

export const peopleImportSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export const apolloMappingSchema = z.record(z.string(), z.string().max(500));

export const personSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  sourceRecordKey: z.string().nullable(),
  fullName: z.string(),
  firstName: z.string(),
  profileUrl: z.string(),
  email: z.string().nullable(),
  companyRaw: z.string().nullable(),
  position: z.string().nullable(),
  mappedCompanyId: z.number().int().positive().nullable(),
  isStarred: z.boolean(),
  isActive: z.boolean(),
  lastSeenAt: z.string(),
  company: z.object({ id: z.number().int().positive(), name: z.string() }).nullable(),
}).passthrough();

export const peopleListResponseSchema = z.object({
  people: z.array(personSchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const personResponseSchema = personSchema;
export const peopleOperationResponseSchema = z.object({
  success: z.boolean().optional(),
  updatedCount: z.number().int().nonnegative().optional(),
  deletedCount: z.number().int().nonnegative().optional(),
  mappedPeopleCount: z.number().int().nonnegative().optional(),
  mappedCompanyCount: z.number().int().nonnegative().optional(),
}).passthrough();
export const peopleClearResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
}).passthrough();
export const peopleRefreshMappingsResponseSchema = z.object({
  mappedPeopleCount: z.number().int().nonnegative(),
  mappedCompanyCount: z.number().int().nonnegative(),
}).passthrough();
export const peopleImportPreviewResponseSchema = z.object({
  source: peopleSourceSchema,
  detectedHeaders: z.array(z.string()),
  suggestedMapping: z.record(z.string(), z.string().nullable()),
  sampleRows: z.array(z.record(z.string(), z.string())),
  totalRows: z.number().int().nonnegative(),
});
export const peopleImportResponseSchema = z.object({
  sessionId: z.string(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  fileName: z.string(),
  totalRows: z.number().int().nonnegative(),
  insertedRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  deactivatedRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  unmatchedCompanyRows: z.number().int().nonnegative(),
  errors: z.array(z.object({ rowNumber: z.number().int().positive(), reason: z.string() })),
});
export const peopleImportSessionsResponseSchema = z.array(z.object({
  id: z.string(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  fileName: z.string(),
  startedAt: z.string(),
}).passthrough());
const unmatchedSummarySchema = z.object({
  unmatchedCompanyCount: z.number().int().nonnegative(),
  unmatchedPeopleCount: z.number().int().nonnegative(),
  ignoredCompanyCount: z.number().int().nonnegative(),
});
export const unmatchedCompaniesResponseSchema = z.object({
  summary: unmatchedSummarySchema,
  groups: z.array(z.object({
    companyNormalized: z.string(),
    companyLabel: z.string(),
    peopleCount: z.number().int().nonnegative(),
    isIgnored: z.boolean(),
  })),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const unmatchedCompanyPeopleResponseSchema = z.object({
  people: z.array(z.object({
    id: z.number().int().positive(),
    fullName: z.string(),
    position: z.string().nullable(),
    email: z.string().nullable(),
    profileUrl: z.string(),
    isStarred: z.boolean(),
  })),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
