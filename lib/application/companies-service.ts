import type { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { logApiFailure, type ApiRequestContext } from "@/lib/api";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type {
  companyCreateBodySchema,
  companyImportBodySchema,
  companyPatchBodySchema,
  companyReplaceBodySchema,
  CompanyOverviewSection,
} from "@/lib/api/contracts/companies";
import { companyPlatformSchema } from "@/lib/api/contracts/companies";
import {
  getCurrentMatchContext,
  getMatchPresentations,
} from "@/lib/ai/matcher/presentation";
import { buildPreferredMatchResultId } from "@/lib/ai/matcher/presentation-query";
import { isCompanyScrapeSupported } from "@/lib/companies/scrape-support";
import { normalizeCareersUrl } from "@/lib/companies/normalization";
import { db } from "@/lib/db";
import { companies, jobs, matchResults, matchSessions, people, scrapingLogs } from "@/lib/db/schema";
import { completeEmptyMatchSession, fetchCompanyJobIds, queueMatchWork } from "@/lib/ai/work-items";
import { refreshUnmatchedCompanyMappings } from "@/lib/people/sync";
import { isRecruiterPosition } from "@/lib/people/position";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import { getLocalScrapeQueueService } from "@/lib/scraper";

type CompanyInput = z.infer<typeof companyCreateBodySchema>;
type CompanyImportInput = z.infer<typeof companyImportBodySchema>;
type CompanyReplaceInput = z.infer<typeof companyReplaceBodySchema>;
type CompanyPatchInput = z.infer<typeof companyPatchBodySchema>;
type CompanyUpdatePayload = Partial<CompanyReplaceInput> & { updatedAt: Date };
type PreparedCompany = CompanyInput & { careersUrl: string; normalizedCareersUrl: string };

const MANUAL_BOARD_TOKEN_REQUIRED = new Set([
  "greenhouse",
  "smartrecruiters",
  "lever",
  "ashby",
  "turbohire",
  "jobvite",
  "talentbrew",
  "oracle",
  "phenom",
]);
const COMPANY_JOB_SELECTION = {
  id: jobs.id, title: jobs.title, url: jobs.url,
  status: jobs.status, location: jobs.location, locationType: jobs.locationType,
  seniorityLevel: jobs.seniorityLevel, department: jobs.department,
  employmentType: jobs.employmentType, salary: jobs.salary,
  discoveredAt: jobs.discoveredAt, viewedAt: jobs.viewedAt,
} as const;

function normalizeOptionalText(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateBoardTokenRequirement(platform: CompanyInput["platform"], careersUrl: string, boardToken?: string | null) {
  if (!platform || !MANUAL_BOARD_TOKEN_REQUIRED.has(platform)) return;
  if (detectPlatformFromUrl(careersUrl) === platform) return;
  if (!normalizeOptionalText(boardToken)) {
    throw new ValidationError(
      `boardToken is required when manually selecting ${platform} platform with a custom URL`,
      "board_token_required"
    );
  }
}

async function refreshMappings(context: ApiRequestContext, companyIds: number[]) {
  if (companyIds.length === 0) return;
  try {
    await refreshUnmatchedCompanyMappings({ companyIds });
  } catch (error) {
    logApiFailure(context, "unmatched_mapping_refresh_failed", 500, error);
  }
}

function prepareCompany(input: CompanyInput): PreparedCompany {
  validateBoardTokenRequirement(input.platform, input.careersUrl, input.boardToken);
  const careersUrl = input.careersUrl.trim();
  return { ...input, careersUrl, normalizedCareersUrl: normalizeCareersUrl(careersUrl) };
}

function prepareCompanies(items: CompanyInput[]): PreparedCompany[] {
  const prepared = items.map(prepareCompany);
  const seen = new Set<string>();
  for (const item of prepared) {
    if (seen.has(item.normalizedCareersUrl)) {
      throw new ConflictError(
        "Company payload contains duplicate careers URLs",
        "duplicate_company_url"
      );
    }
    seen.add(item.normalizedCareersUrl);
  }
  return prepared;
}

function companyValues(input: PreparedCompany) {
  const platform = input.platform ?? detectPlatformFromUrl(input.careersUrl);
  return {
    careersUrl: input.careersUrl,
    normalizedCareersUrl: input.normalizedCareersUrl,
    name: input.name,
    logoUrl: normalizeOptionalText(input.logoUrl),
    notes: normalizeOptionalText(input.notes),
    platform,
    boardToken: normalizeOptionalText(input.boardToken),
    isActive: true,
  };
}

function isConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT");
}

function runCompanyWrite<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isConstraintError(error)) {
      throw new ConflictError("Company careers URL already exists", "duplicate_company_url");
    }
    throw error;
  }
}

type CompanyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function findCompanyByIdentity(tx: CompanyTransaction, normalized: string) {
  const indexed = tx.select().from(companies).where(eq(companies.normalizedCareersUrl, normalized)).get();
  if (indexed) return indexed;
  // Supports rows inserted by older integrations until their next migration.
  return tx.select().from(companies).where(isNull(companies.normalizedCareersUrl)).all()
    .find((company) => normalizeCareersUrl(company.careersUrl) === normalized);
}

function upsertPreparedCompany(tx: CompanyTransaction, input: PreparedCompany) {
  const values = companyValues(input);
  const existing = findCompanyByIdentity(tx, input.normalizedCareersUrl);
  return existing
    ? tx.update(companies).set({ ...values, updatedAt: new Date() }).where(eq(companies.id, existing.id)).returning().get()
    : tx.insert(companies).values(values).returning().get();
}

export const listCompanies = () => db.select().from(companies).orderBy(desc(companies.createdAt));

export async function importCompanies(input: CompanyImportInput, context: ApiRequestContext) {
  const isBulk = Array.isArray(input);
  const items = prepareCompanies(isBulk ? input : [input]);
  const results = runCompanyWrite(() => db.transaction((tx) => {
    return items.map((item) => upsertPreparedCompany(tx, item));
  }, { behavior: "immediate" }));
  await refreshMappings(context, results.map(({ id }) => id));
  return isBulk ? results : results[0];
}

export async function syncCompanies(input: CompanyInput[], context: ApiRequestContext) {
  const items = prepareCompanies(input);
  const touchedIds = runCompanyWrite(() => db.transaction((tx) => {
    const existingCompanies = tx.select().from(companies).all();
    const incomingUrls = new Set(items.map(({ normalizedCareersUrl }) => normalizedCareersUrl));
    const ids = items.map((item) => upsertPreparedCompany(tx, item).id);
    const now = new Date();
    for (const company of existingCompanies) {
      if (!incomingUrls.has(normalizeCareersUrl(company.careersUrl)) && company.isActive) {
        tx.update(companies).set({ isActive: false, updatedAt: now })
          .where(eq(companies.id, company.id)).run();
      }
    }
    return ids;
  }, { behavior: "immediate" }));
  await refreshMappings(context, touchedIds);
  return { success: true as const };
}

export async function getCompany(id: number) {
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) throw new NotFoundError("Company not found", "company_not_found");
  return company;
}

export async function replaceCompany(id: number, input: CompanyReplaceInput, context: ApiRequestContext) {
  const prepared = prepareCompany(input);
  const updated = runCompanyWrite(() => db.transaction((tx) => {
    const existing = tx.select().from(companies).where(eq(companies.id, id)).get();
    if (!existing) throw new NotFoundError("Company not found", "company_not_found");
    const duplicate = findCompanyByIdentity(tx, prepared.normalizedCareersUrl);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError("Company careers URL already exists", "duplicate_company_url");
    }
    return tx.update(companies).set({
      ...companyValues(prepared),
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    }).where(eq(companies.id, id)).returning().get();
  }, { behavior: "immediate" }));
  await refreshMappings(context, [updated.id]);
  return updated;
}

export async function patchCompany(id: number, input: CompanyPatchInput, context: ApiRequestContext) {
  const updated = runCompanyWrite(() => db.transaction((tx) => {
    const existing = tx.select().from(companies).where(eq(companies.id, id)).get();
    if (!existing) throw new NotFoundError("Company not found", "company_not_found");
    const existingPlatform = companyPlatformSchema.nullable().safeParse(existing.platform);
    const effectivePlatform = input.platform !== undefined
      ? input.platform
      : existingPlatform.success ? existingPlatform.data : null;
    const effectiveCareersUrl = (input.careersUrl ?? existing.careersUrl).trim();
    const effectiveBoardToken = input.boardToken !== undefined ? input.boardToken : existing.boardToken;
    validateBoardTokenRequirement(effectivePlatform, effectiveCareersUrl, effectiveBoardToken);

    if (input.careersUrl !== undefined) {
      const normalizedCareersUrl = normalizeCareersUrl(effectiveCareersUrl);
      const duplicate = findCompanyByIdentity(tx, normalizedCareersUrl);
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError("Company careers URL already exists", "duplicate_company_url");
      }
    }

    const updateData: CompanyUpdatePayload = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.careersUrl !== undefined) {
      updateData.careersUrl = effectiveCareersUrl;
    }
    if (input.logoUrl !== undefined) updateData.logoUrl = normalizeOptionalText(input.logoUrl);
    if (input.notes !== undefined) updateData.notes = normalizeOptionalText(input.notes);
    if (input.isActive !== undefined) updateData.isActive = input.isActive;
    if (input.platform !== undefined) updateData.platform = input.platform;
    if (input.boardToken !== undefined) updateData.boardToken = normalizeOptionalText(input.boardToken);
    return tx.update(companies).set({ ...updateData, ...(input.careersUrl !== undefined ? { normalizedCareersUrl: normalizeCareersUrl(effectiveCareersUrl) } : {}) }).where(eq(companies.id, id)).returning().get();
  }, { behavior: "immediate" }));
  if (input.name !== undefined) await refreshMappings(context, [updated.id]);
  return updated;
}

export async function deleteCompany(id: number) {
  const result = await getLocalDataMaintenanceService().deleteCompanies([id]);
  if (result.deletedCompanies === 0) throw new NotFoundError("Company not found", "company_not_found");
  return { success: true as const };
}

export async function deleteCompanyJobs(id: number) {
  await getCompany(id);
  const deletedCount = await getLocalDataMaintenanceService().deleteCompanyJobs([id]);
  return { success: true as const, deletedCount, message: `Deleted ${deletedCount} job(s) for company ${id}` };
}

export async function deleteBulkCompanyJobs(companyIds: number[]) {
  const deletedCount = await getLocalDataMaintenanceService().deleteCompanyJobs(companyIds);
  return { success: true as const, deletedCount, message: `Deleted ${deletedCount} jobs from ${companyIds.length} companies` };
}

export async function deleteBulkCompanies(companyIds: number[]) {
  const { deletedJobs, deletedCompanies } = await getLocalDataMaintenanceService().deleteCompanies(companyIds);
  return { success: true as const, deletedCompanies, deletedJobs, message: `Deleted ${deletedCompanies} companies and ${deletedJobs} jobs` };
}

export async function setCompaniesActive(companyIds: number[], isActive: boolean) {
  const updated = await db.update(companies).set({ isActive, updatedAt: new Date() })
    .where(inArray(companies.id, companyIds)).returning({ id: companies.id });
  return { success: true as const, updated: updated.length, message: `Updated ${updated.length} companies to ${isActive ? "active" : "paused"}` };
}

export async function queueCompaniesMatch(companyIds: number[]) {
  const jobIds = await fetchCompanyJobIds(companyIds);
  return jobIds.length === 0
    ? completeEmptyMatchSession({ triggerSource: "manual" })
    : queueMatchWork({ jobIds, triggerSource: "manual" });
}

export function refreshCompanyJobs(companyIds: number[]) {
  return getLocalScrapeQueueService().submitCompanies(companyIds, "manual");
}

export async function getCompanyOverview(id: number, now = new Date(), section: CompanyOverviewSection = "all") {
  const includeJobs = section === "all" || section === "jobs";
  const includePeople = section === "all" || section === "people";
  const includeActivity = section === "all" || section === "activity";
  const company = await getCompany(id);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const discoveredLast7Days = and(gte(jobs.discoveredAt, sevenDaysAgo), lte(jobs.discoveredAt, now));
  const currentContext = await getCurrentMatchContext();
  const preferredMatchResults = matchResults;
  const preferredResultJoin = eq(matchResults.id, buildPreferredMatchResultId(currentContext));
  const effectiveScore = preferredMatchResults.score;
  const promotionCountQuery = db.select({
    value: sql<number>`coalesce(sum(case when ${effectiveScore} >= 70 then 1 else 0 end), 0)`,
  }).from(jobs).leftJoin(preferredMatchResults, preferredResultJoin);
  const promotionCountPromise = promotionCountQuery.where(eq(jobs.companyId, id));
  const topMatchJobsPromise = db.select(COMPANY_JOB_SELECTION).from(jobs)
    .leftJoin(preferredMatchResults, preferredResultJoin)
    .where(and(eq(jobs.companyId, id), gte(effectiveScore, 70)))
    .orderBy(desc(effectiveScore), desc(jobs.discoveredAt), desc(jobs.id))
    .limit(3);
  const [jobStatsRows, peopleStatsRows, companyJobs, companyPeople, scrapeLogs, matchSessionRows, promotionCountRows, topMatchJobs] = await Promise.all([
    db.select({
      openJobs: sql<number>`coalesce(sum(case when ${jobs.status} not in ('rejected', 'archived') then 1 else 0 end), 0)`,
      newJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'new' then 1 else 0 end), 0)`,
      viewedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'viewed' then 1 else 0 end), 0)`,
      interestedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'interested' then 1 else 0 end), 0)`,
      appliedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'applied' then 1 else 0 end), 0)`,
      rejectedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'rejected' then 1 else 0 end), 0)`,
      archivedJobs: sql<number>`coalesce(sum(case when ${jobs.status} = 'archived' then 1 else 0 end), 0)`,
      jobsDiscoveredLast7Days: sql<number>`coalesce(sum(case when ${discoveredLast7Days} then 1 else 0 end), 0)`,
    }).from(jobs).where(eq(jobs.companyId, id)),
    db.select({
      mappedPeople: sql<number>`count(*)`,
      starredPeople: sql<number>`sum(case when ${people.isStarred} = 1 then 1 else 0 end)`,
    }).from(people).where(and(
      eq(people.mappedCompanyId, id),
      eq(people.isActive, true),
      isNull(people.archivedAt)
    )),
    includeJobs ? db.select(COMPANY_JOB_SELECTION).from(jobs).where(eq(jobs.companyId, id)).orderBy(desc(jobs.discoveredAt), desc(jobs.id)).limit(50) : Promise.resolve([]),
    includePeople ? db.select({
      id: people.id, fullName: people.fullName, firstName: people.firstName,
      lastName: people.lastName, profileUrl: people.profileUrl, email: people.email,
      position: people.position, source: people.source, connectedOn: people.connectedOn,
      isStarred: people.isStarred, notes: people.notes, roleTag: people.roleTag,
      roleTagSource: people.roleTagSource, lastSeenAt: people.lastSeenAt,
      createdAt: people.createdAt, updatedAt: people.updatedAt,
    }).from(people).where(and(
      eq(people.mappedCompanyId, id),
      eq(people.isActive, true),
      isNull(people.archivedAt)
    ))
      .orderBy(desc(people.isStarred), people.fullName, desc(people.id)).limit(200) : Promise.resolve([]),
    includeActivity ? db.select({
      id: scrapingLogs.id, status: scrapingLogs.status, triggerSource: scrapingLogs.triggerSource,
      jobsFound: scrapingLogs.jobsFound, jobsAdded: scrapingLogs.jobsAdded,
      startedAt: scrapingLogs.startedAt, completedAt: scrapingLogs.completedAt,
    }).from(scrapingLogs).where(eq(scrapingLogs.companyId, id)).orderBy(desc(scrapingLogs.startedAt), desc(scrapingLogs.id)).limit(20) : Promise.resolve([]),
    includeActivity ? db.select({
      id: matchSessions.id, status: matchSessions.status, triggerSource: matchSessions.triggerSource,
      jobsTotal: matchSessions.jobsTotal, jobsCompleted: matchSessions.jobsCompleted,
      jobsSucceeded: matchSessions.jobsSucceeded, jobsFailed: matchSessions.jobsFailed,
      startedAt: matchSessions.startedAt, completedAt: matchSessions.completedAt,
    }).from(matchSessions).where(eq(matchSessions.companyId, id)).orderBy(desc(matchSessions.startedAt), desc(matchSessions.id)).limit(20) : Promise.resolve([]),
    promotionCountPromise,
    includeJobs ? topMatchJobsPromise : Promise.resolve([]),
  ]);
  const presentationJobs = [...new Map([...companyJobs, ...topMatchJobs].map((job) => [job.id, job])).values()];
  const presentations = await getMatchPresentations(presentationJobs.map((job) => ({ ...job, description: null })), currentContext, { summaryOnly: true });
  const present = (rows: typeof companyJobs, values: Awaited<ReturnType<typeof getMatchPresentations>>) => rows.map((job) => {
    const presentation = values.get(job.id);
    if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
    return {
      id: job.id, title: job.title, url: job.url, status: job.status,
      location: job.location, locationType: job.locationType,
      discoveredAt: job.discoveredAt, viewedAt: job.viewedAt,
      matchScore: presentation.matchScore, matchLegacy: presentation.matchLegacy,
    };
  });
  return {
    company: { ...company, canScrapeJobs: isCompanyScrapeSupported(company.careersUrl, company.platform) },
    stats: {
      openJobs: Number(jobStatsRows[0]?.openJobs ?? 0),
      highMatchJobs: Number(promotionCountRows[0]?.value ?? 0),
      mappedPeople: peopleStatsRows[0]?.mappedPeople || 0,
      starredPeople: peopleStatsRows[0]?.starredPeople || 0,
      statusCounts: {
        new: Number(jobStatsRows[0]?.newJobs ?? 0),
        viewed: Number(jobStatsRows[0]?.viewedJobs ?? 0),
        interested: Number(jobStatsRows[0]?.interestedJobs ?? 0),
        applied: Number(jobStatsRows[0]?.appliedJobs ?? 0),
        rejected: Number(jobStatsRows[0]?.rejectedJobs ?? 0),
        archived: Number(jobStatsRows[0]?.archivedJobs ?? 0),
      },
      jobsDiscoveredLast7Days: Number(jobStatsRows[0]?.jobsDiscoveredLast7Days ?? 0),
      lastJobDiscoveredAt: includeJobs ? companyJobs[0]?.discoveredAt ?? null
        : (await db.select({ discoveredAt: jobs.discoveredAt }).from(jobs)
          .where(eq(jobs.companyId, id)).orderBy(desc(jobs.discoveredAt), desc(jobs.id)).limit(1))[0]?.discoveredAt ?? null,
    },
    jobs: present(companyJobs, presentations),
    topMatches: present(topMatchJobs, presentations),
    people: companyPeople.map((person) => ({
      ...person,
      isRecruiter: isRecruiterPosition(person.position),
    })),
    activity: { scrapeLogs, matchSessions: matchSessionRows },
  };
}
