import { z } from "zod";

import { positiveIntegerIdSchema } from "./common";

const nullableIsoDateSchema = z.iso.datetime().nullable();

export const peopleSourceSchema = z.enum(["linkedin", "apollo"]);
export const peopleImportModeSchema = z.enum(["merge", "replace"]);
export const personIdParamsSchema = z.object({ id: positiveIntegerIdSchema });
export const personSourceParamsSchema = z.object({
  id: positiveIntegerIdSchema,
  sourceRecordId: positiveIntegerIdSchema,
});
export const peopleImportSessionParamsSchema = z.object({ id: z.string().trim().min(1).max(200) });

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
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

export const peopleImportSessionDetailQuerySchema = z.object({
  issueLimit: z.coerce.number().int().positive().max(200).default(100),
  issueOffset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

export const peopleDuplicatesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

export const personMergeBodySchema = z.object({
  duplicatePersonId: positiveIntegerIdSchema,
});

export const companyAliasesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
});

export const companyAliasPatchBodySchema = z.object({
  mappedCompanyId: positiveIntegerIdSchema,
  updateExistingPeople: z.boolean(),
});

export const companyAliasDeleteQuerySchema = z.object({
  existingPeople: z.enum(["keep", "unmap"]),
});

export const apolloMappingSchema = z.record(z.string(), z.string().max(500));

export const personResponseSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  sourceRecordKey: z.string().nullable(),
  identityKey: z.string(),
  fullName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  profileUrl: z.string(),
  profileUrlNormalized: z.string(),
  email: z.string().nullable(),
  companyRaw: z.string().nullable(),
  companyNormalized: z.string().nullable(),
  position: z.string().nullable(),
  mappedCompanyId: z.number().int().positive().nullable(),
  isStarred: z.boolean(),
  isActive: z.boolean(),
  lastSeenAt: z.iso.datetime(),
  connectedOn: nullableIsoDateSchema,
  roleTag: z.string().nullable(),
  roleTagSource: z.string().nullable(),
  notes: z.string().nullable(),
  archivedAt: nullableIsoDateSchema,
  createdAt: nullableIsoDateSchema,
  updatedAt: nullableIsoDateSchema,
  isRecruiter: z.boolean(),
  company: z.object({ id: z.number().int().positive(), name: z.string() }).nullable(),
}).passthrough();

const personSourceRecordResponseSchema = z.object({
  id: z.number().int().positive(),
  personId: z.number().int().positive(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  sourceRecordKey: z.string(),
  stableIdentityKey: z.string().nullable(),
  identityKind: z.enum(["linkedin_url", "email", "composite", "manual"]).nullable(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  profileUrl: z.string(),
  profileUrlNormalized: z.string().nullable(),
  email: z.string().nullable(),
  emailNormalized: z.string().nullable(),
  companyRaw: z.string().nullable(),
  companyNormalized: z.string().nullable(),
  position: z.string().nullable(),
  connectedOn: nullableIsoDateSchema,
  sourceNotes: z.string().nullable(),
  isActive: z.boolean(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  lastImportSessionId: z.string().nullable(),
  createdAt: nullableIsoDateSchema,
  updatedAt: nullableIsoDateSchema,
});

export const personDetailResponseSchema = personResponseSchema.extend({
  sources: z.array(personSourceRecordResponseSchema),
});

export const peopleListResponseSchema = z.object({
  people: z.array(personResponseSchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
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
  unchangedRows: z.number().int().nonnegative(),
  reactivatedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  deactivatedRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  unmatchedCompanyRows: z.number().int().nonnegative(),
  errors: z.array(z.object({ rowNumber: z.number().int().positive(), reason: z.string() })),
});
const peopleImportSessionResponseSchema = z.object({
  id: z.string(),
  source: z.enum(["linkedin", "apollo", "manual"]),
  fileName: z.string(),
  importMode: peopleImportModeSchema,
  totalRows: z.number().int().nonnegative(),
  insertedRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  unchangedRows: z.number().int().nonnegative(),
  reactivatedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  deactivatedRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  unmatchedCompanyRows: z.number().int().nonnegative(),
  startedAt: z.iso.datetime(),
  completedAt: nullableIsoDateSchema,
  status: z.enum(["in_progress", "completed", "failed"]),
  errorMessage: z.string().nullable(),
});
export const peopleImportSessionsResponseSchema = z.object({
  sessions: z.array(peopleImportSessionResponseSchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});
export const peopleImportSessionDetailResponseSchema = peopleImportSessionResponseSchema.extend({
  issues: z.array(z.object({
    id: z.number().int().positive(),
    rowNumber: z.number().int().positive(),
    kind: z.enum(["invalid", "duplicate", "ambiguous_identity"]),
    reason: z.string(),
    sourceRecordKey: z.string().nullable(),
    createdAt: nullableIsoDateSchema,
  })),
  issuePagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  }),
});

const duplicatePersonSummarySchema = personResponseSchema.pick({
  id: true,
  source: true,
  fullName: true,
  profileUrl: true,
  email: true,
  companyRaw: true,
  position: true,
  isActive: true,
  archivedAt: true,
});
export const peopleDuplicatesResponseSchema = z.object({
  groups: z.array(z.object({
    identityKind: z.enum(["linkedin_url", "email"]),
    identityValue: z.string(),
    matchReasons: z.array(z.enum(["exact_linkedin_url", "exact_email"])).min(1),
    people: z.array(duplicatePersonSummarySchema).min(2),
  })),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export const personMergeResponseSchema = z.object({
  person: personDetailResponseSchema,
  mergedPersonId: z.number().int().positive(),
});
export const personSplitResponseSchema = z.object({
  person: personDetailResponseSchema,
  createdPerson: personDetailResponseSchema,
});
export const personPurgeResponseSchema = z.object({
  deletedId: z.number().int().positive(),
});

const companyAliasResponseSchema = z.object({
  id: z.number().int().positive(),
  companyNormalized: z.string(),
  mappedCompanyId: z.number().int().positive(),
  mappedCompany: z.object({ id: z.number().int().positive(), name: z.string() }),
  affectedPeopleCount: z.number().int().nonnegative(),
  createdAt: nullableIsoDateSchema,
});
export const companyAliasesResponseSchema = z.object({
  aliases: z.array(companyAliasResponseSchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export const companyAliasMutationResponseSchema = z.object({
  alias: companyAliasResponseSchema.nullable(),
  updatedPeopleCount: z.number().int().nonnegative(),
});
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

export type Person = z.infer<typeof personResponseSchema>;
export type PersonSource = Person["source"];
export type PeopleImportMode = z.infer<typeof peopleImportModeSchema>;
export type PeopleResponse = z.infer<typeof peopleListResponseSchema>;
export type PeopleImportPreviewResponse = z.infer<typeof peopleImportPreviewResponseSchema>;
export type PeopleImportResponse = z.infer<typeof peopleImportResponseSchema>;
export type PeopleImportSessionsResponse = z.infer<typeof peopleImportSessionsResponseSchema>;
export type PeopleImportSession = PeopleImportSessionsResponse["sessions"][number];
export type PersonDetail = z.infer<typeof personDetailResponseSchema>;
export type PeopleDuplicatesResponse = z.infer<typeof peopleDuplicatesResponseSchema>;
export type PeopleImportSessionDetailResponse = z.infer<typeof peopleImportSessionDetailResponseSchema>;
export type CompanyAliasesResponse = z.infer<typeof companyAliasesResponseSchema>;
export type UnmatchedCompaniesResponse = z.infer<typeof unmatchedCompaniesResponseSchema>;
export type UnmatchedCompanyPeopleResponse = z.infer<typeof unmatchedCompanyPeopleResponseSchema>;
