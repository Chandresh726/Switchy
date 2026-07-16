import type { z } from "zod";
import { and, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import {
  NotFoundError,
  ValidationError,
  logApiFailure,
  type ApiRequestContext,
} from "@/lib/api";
import type {
  companyCreateBodySchema,
  companyImportBodySchema,
  companyPatchBodySchema,
  companyReplaceBodySchema,
} from "@/lib/api/contracts/companies";
import { companyPlatformSchema } from "@/lib/api/contracts/companies";
import { getCurrentMatchContext, getMatchPresentations } from "@/lib/ai/matcher/presentation";
import { countPromotedMatchRows } from "@/lib/ai/matcher/promotion";
import { isCompanyScrapeSupported } from "@/lib/companies/scrape-support";
import { db } from "@/lib/db";
import { companies, jobs, matchResults, matchSessions, people, scrapingLogs } from "@/lib/db/schema";
import { completeEmptyMatchSession, fetchCompanyJobIds, queueMatchWork } from "@/lib/ai/work-items";
import { refreshUnmatchedCompanyMappings } from "@/lib/people/sync";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import { getLocalScrapeQueueService } from "@/lib/scraper";

type CompanyInput = z.infer<typeof companyCreateBodySchema>;
type CompanyImportInput = z.infer<typeof companyImportBodySchema>;
type CompanyReplaceInput = z.infer<typeof companyReplaceBodySchema>;
type CompanyPatchInput = z.infer<typeof companyPatchBodySchema>;
type CompanyUpdatePayload = Partial<CompanyReplaceInput> & { updatedAt: Date };

const MANUAL_BOARD_TOKEN_REQUIRED = new Set(["greenhouse", "lever", "ashby"]);
const COMPANY_JOB_SELECTION = {
  id: jobs.id, title: jobs.title, description: jobs.description, url: jobs.url,
  status: jobs.status, location: jobs.location, locationType: jobs.locationType,
  seniorityLevel: jobs.seniorityLevel, department: jobs.department,
  employmentType: jobs.employmentType, salary: jobs.salary, matchScore: jobs.matchScore,
  matchReasons: jobs.matchReasons, matchedSkills: jobs.matchedSkills,
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

async function upsertCompany(input: CompanyInput) {
  validateBoardTokenRequirement(input.platform, input.careersUrl, input.boardToken);
  const platform = input.platform ?? detectPlatformFromUrl(input.careersUrl);
  const values = {
    name: input.name,
    logoUrl: normalizeOptionalText(input.logoUrl),
    notes: normalizeOptionalText(input.notes),
    platform,
    boardToken: normalizeOptionalText(input.boardToken),
    isActive: true,
  };
  const [existing] = await db.select().from(companies).where(eq(companies.careersUrl, input.careersUrl));
  if (existing) {
    const [updated] = await db.update(companies).set({ ...values, updatedAt: new Date() }).where(eq(companies.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(companies).values({ ...values, careersUrl: input.careersUrl }).returning();
  return created;
}

export const listCompanies = () => db.select().from(companies).orderBy(desc(companies.createdAt));

export async function importCompanies(input: CompanyImportInput, context: ApiRequestContext) {
  const isBulk = Array.isArray(input);
  const items = isBulk ? input : [input];
  const results = [];
  for (const item of items) {
    try {
      results.push(await upsertCompany(item));
    } catch (error) {
      if (!isBulk || !(error instanceof ValidationError)) throw error;
    }
  }
  await refreshMappings(context, results.map(({ id }) => id));
  return isBulk ? results : results[0];
}

export async function syncCompanies(input: CompanyInput[], context: ApiRequestContext) {
  const incomingUrls = new Set(input.map(({ careersUrl }) => careersUrl));
  const touchedIds: number[] = [];
  for (const item of input) {
    try {
      touchedIds.push((await upsertCompany(item)).id);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  const allCompanies = await db.select().from(companies);
  for (const company of allCompanies) {
    if (!incomingUrls.has(company.careersUrl) && company.isActive) {
      await db.update(companies).set({ isActive: false, updatedAt: new Date() }).where(eq(companies.id, company.id));
    }
  }
  await refreshMappings(context, touchedIds);
  return { success: true as const };
}

export async function getCompany(id: number) {
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) throw new NotFoundError("Company not found", "company_not_found");
  return company;
}

export async function replaceCompany(id: number, input: CompanyReplaceInput, context: ApiRequestContext) {
  validateBoardTokenRequirement(input.platform, input.careersUrl, input.boardToken);
  const [updated] = await db.update(companies).set({
    ...input,
    logoUrl: normalizeOptionalText(input.logoUrl),
    notes: normalizeOptionalText(input.notes),
    boardToken: normalizeOptionalText(input.boardToken),
    updatedAt: new Date(),
  }).where(eq(companies.id, id)).returning();
  if (!updated) throw new NotFoundError("Company not found", "company_not_found");
  await refreshMappings(context, [updated.id]);
  return updated;
}

export async function patchCompany(id: number, input: CompanyPatchInput, context: ApiRequestContext) {
  const existing = await getCompany(id);
  const existingPlatform = companyPlatformSchema.nullable().safeParse(existing.platform);
  const effectivePlatform = input.platform !== undefined
    ? input.platform
    : existingPlatform.success ? existingPlatform.data : null;
  const effectiveCareersUrl = input.careersUrl ?? existing.careersUrl;
  const effectiveBoardToken = input.boardToken !== undefined ? input.boardToken : existing.boardToken;
  validateBoardTokenRequirement(effectivePlatform, effectiveCareersUrl, effectiveBoardToken);

  const updateData: CompanyUpdatePayload = { updatedAt: new Date() };
  if (input.name !== undefined) updateData.name = input.name;
  if (input.careersUrl !== undefined) updateData.careersUrl = input.careersUrl;
  if (input.logoUrl !== undefined) updateData.logoUrl = normalizeOptionalText(input.logoUrl);
  if (input.notes !== undefined) updateData.notes = normalizeOptionalText(input.notes);
  if (input.isActive !== undefined) updateData.isActive = input.isActive;
  if (input.platform !== undefined) updateData.platform = input.platform;
  if (input.boardToken !== undefined) updateData.boardToken = normalizeOptionalText(input.boardToken);
  const [updated] = await db.update(companies).set(updateData).where(eq(companies.id, id)).returning();
  if (!updated) throw new NotFoundError("Company not found", "company_not_found");
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

export async function queueCompanyMatch(companyId: number) {
  await getCompany(companyId);
  const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.companyId, companyId));
  return rows.length === 0
    ? completeEmptyMatchSession({ triggerSource: "company_refresh", companyId })
    : queueMatchWork({ jobIds: rows.map(({ id }) => id), triggerSource: "company_refresh", companyId });
}

export async function queueCompaniesMatch(companyIds: number[]) {
  const jobIds = await fetchCompanyJobIds(companyIds);
  return jobIds.length === 0
    ? completeEmptyMatchSession({ triggerSource: "manual" })
    : queueMatchWork({ jobIds, triggerSource: "manual" });
}

export async function refreshCompanyJobs(companyIds: number[]) {
  const result = await getLocalScrapeQueueService().scrapeCompanies(companyIds, "manual");
  const { summary } = result;
  const messageParts = [`Refreshed ${summary.successfulCompanies} compan${summary.successfulCompanies === 1 ? "y" : "ies"}`];
  if (summary.skippedCompanies > 0) messageParts.push(`skipped ${summary.skippedCompanies} custom compan${summary.skippedCompanies === 1 ? "y" : "ies"} without scraping support`);
  if (summary.failedCompanies > 0) messageParts.push(`${summary.failedCompanies} compan${summary.failedCompanies === 1 ? "y failed" : "ies failed"}`);
  return {
    success: summary.failedCompanies === 0,
    sessionId: result.sessionId,
    totalCompanies: summary.totalCompanies,
    refreshedCompanies: summary.successfulCompanies,
    skippedCompanies: summary.skippedCompanies,
    totalJobsFound: summary.totalJobsFound,
    totalJobsAdded: summary.totalJobsAdded,
    totalJobsFiltered: summary.totalJobsFiltered,
    failedCompanies: summary.failedCompanies,
    message: `${messageParts.join(", ")}. Found ${summary.totalJobsFound} jobs, added ${summary.totalJobsAdded} new.`,
  };
}

export async function getCompanyOverview(id: number) {
  const company = await getCompany(id);
  const currentContext = await getCurrentMatchContext();
  const currentResultJoin = currentContext ? and(
    eq(matchResults.jobId, jobs.id),
    eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
    eq(matchResults.isStale, false)
  ) : null;
  const promotionRowsPromise = currentContext
    ? db.select({ score: matchResults.score, legacyScore: jobs.matchScore }).from(jobs)
      .leftJoin(matchResults, currentResultJoin!).where(eq(jobs.companyId, id))
    : db.select({ score: sql<number | null>`null`, legacyScore: jobs.matchScore }).from(jobs).where(eq(jobs.companyId, id));
  const topMatchJobsPromise = currentContext
    ? db.select(COMPANY_JOB_SELECTION).from(jobs).leftJoin(matchResults, currentResultJoin!)
      .where(and(eq(jobs.companyId, id), or(gte(matchResults.score, 70), and(isNull(matchResults.id), gte(jobs.matchScore, 70)))))
      .orderBy(desc(sql<number | null>`coalesce(${matchResults.score}, ${jobs.matchScore})`), desc(jobs.discoveredAt)).limit(3)
    : db.select(COMPANY_JOB_SELECTION).from(jobs).where(and(eq(jobs.companyId, id), gte(jobs.matchScore, 70)))
      .orderBy(desc(jobs.matchScore), desc(jobs.discoveredAt)).limit(3);
  const [jobStatsRows, peopleStatsRows, companyJobs, companyPeople, scrapeLogs, matchSessionRows, promotionRows, topMatchJobs] = await Promise.all([
    db.select({ openJobs: count() }).from(jobs).where(eq(jobs.companyId, id)),
    db.select({
      mappedPeople: sql<number>`count(*)`,
      starredPeople: sql<number>`sum(case when ${people.isStarred} = 1 then 1 else 0 end)`,
    }).from(people).where(and(eq(people.mappedCompanyId, id), eq(people.isActive, true))),
    db.select(COMPANY_JOB_SELECTION).from(jobs).where(eq(jobs.companyId, id)).orderBy(desc(jobs.discoveredAt)).limit(50),
    db.select({
      id: people.id, fullName: people.fullName, firstName: people.firstName,
      lastName: people.lastName, profileUrl: people.profileUrl, email: people.email,
      position: people.position, source: people.source, connectedOn: people.connectedOn,
      isStarred: people.isStarred, notes: people.notes,
    }).from(people).where(and(eq(people.mappedCompanyId, id), eq(people.isActive, true)))
      .orderBy(desc(people.isStarred), people.fullName).limit(200),
    db.select({
      id: scrapingLogs.id, status: scrapingLogs.status, triggerSource: scrapingLogs.triggerSource,
      jobsFound: scrapingLogs.jobsFound, jobsAdded: scrapingLogs.jobsAdded,
      startedAt: scrapingLogs.startedAt, completedAt: scrapingLogs.completedAt,
    }).from(scrapingLogs).where(eq(scrapingLogs.companyId, id)).orderBy(desc(scrapingLogs.startedAt)).limit(20),
    db.select({
      id: matchSessions.id, status: matchSessions.status, triggerSource: matchSessions.triggerSource,
      jobsTotal: matchSessions.jobsTotal, jobsCompleted: matchSessions.jobsCompleted,
      jobsSucceeded: matchSessions.jobsSucceeded, jobsFailed: matchSessions.jobsFailed,
      startedAt: matchSessions.startedAt, completedAt: matchSessions.completedAt,
    }).from(matchSessions).where(eq(matchSessions.companyId, id)).orderBy(desc(matchSessions.startedAt)).limit(20),
    promotionRowsPromise,
    topMatchJobsPromise,
  ]);
  const [presentations, topPresentations] = await Promise.all([
    getMatchPresentations(companyJobs, currentContext),
    getMatchPresentations(topMatchJobs, currentContext, { includeStale: false }),
  ]);
  const present = (rows: typeof companyJobs, values: Awaited<ReturnType<typeof getMatchPresentations>>) => rows.map((job) => {
    const presentation = values.get(job.id);
    if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
    return { ...job, description: undefined, ...presentation };
  });
  return {
    company: { ...company, canScrapeJobs: isCompanyScrapeSupported(company.careersUrl, company.platform) },
    stats: {
      openJobs: jobStatsRows[0]?.openJobs ?? 0,
      highMatchJobs: countPromotedMatchRows(promotionRows),
      mappedPeople: peopleStatsRows[0]?.mappedPeople || 0,
      starredPeople: peopleStatsRows[0]?.starredPeople || 0,
    },
    jobs: present(companyJobs, presentations),
    topMatches: present(topMatchJobs, topPresentations),
    people: companyPeople,
    activity: { scrapeLogs, matchSessions: matchSessionRows },
  };
}
