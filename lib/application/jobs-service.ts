import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  like,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { z } from "zod";

import { getCurrentMatchContext, getMatchPresentations } from "@/lib/ai/matcher/presentation";
import { getUnmatchedJobCount, getUnmatchedJobIds } from "@/lib/ai/matcher";
import { completeEmptyMatchSession, getAIWorkSession, queueMatchWork } from "@/lib/ai/work-items";
import { NotFoundError } from "@/lib/api";
import type { jobResourceUpdateBodySchema, jobsQuerySchema } from "@/lib/api/contracts/jobs";
import { db } from "@/lib/db";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

type JobUpdate = z.infer<typeof jobResourceUpdateBodySchema>;
type JobsQuery = z.infer<typeof jobsQuerySchema>;
type MatchBand = "high" | "good";
const DAY_MS = 24 * 60 * 60 * 1_000;

const JOB_LIST_SELECTION = {
  job: {
    id: jobs.id, companyId: jobs.companyId, externalId: jobs.externalId,
    title: jobs.title, description: jobs.description, descriptionFormat: jobs.descriptionFormat,
    url: jobs.url, location: jobs.location, locationType: jobs.locationType,
    salary: jobs.salary, department: jobs.department, employmentType: jobs.employmentType,
    seniorityLevel: jobs.seniorityLevel, status: jobs.status, postedDate: jobs.postedDate,
    discoveredAt: jobs.discoveredAt, updatedAt: jobs.updatedAt, archivedAt: jobs.archivedAt,
    archiveSource: jobs.archiveSource, viewedAt: jobs.viewedAt, appliedAt: jobs.appliedAt,
    matchScore: jobs.matchScore, matchReasons: jobs.matchReasons, matchedSkills: jobs.matchedSkills,
  },
  company: { id: companies.id, name: companies.name, logoUrl: companies.logoUrl, platform: companies.platform },
} as const;

function legacyBandCondition(bands: MatchBand[]) {
  const high = bands.includes("high");
  const good = bands.includes("good");
  if (high && good) return gte(jobs.matchScore, 70);
  if (high) return gte(jobs.matchScore, 85);
  if (good) return and(gte(jobs.matchScore, 70), lt(jobs.matchScore, 85));
  return sql`0 = 1`;
}

function baseConditions(query: JobsQuery) {
  const conditions = [];
  if (query.companyId) conditions.push(eq(jobs.companyId, query.companyId));
  if (query.companyIds?.length === 1) conditions.push(eq(jobs.companyId, query.companyIds[0]));
  else if (query.companyIds && query.companyIds.length > 1) conditions.push(or(...query.companyIds.map((id) => eq(jobs.companyId, id))));
  if (query.status) conditions.push(eq(jobs.status, query.status));
  else if (query.excludeStatus?.length) conditions.push(notInArray(jobs.status, query.excludeStatus));
  if (query.locationType?.length === 1) conditions.push(eq(jobs.locationType, query.locationType[0]));
  else if (query.locationType && query.locationType.length > 1) conditions.push(or(...query.locationType.map((value) => eq(jobs.locationType, value))));
  if (query.search) conditions.push(or(like(jobs.title, `%${query.search}%`), like(jobs.description, `%${query.search}%`)));
  if (query.department) conditions.push(like(jobs.department, `%${query.department}%`));
  const employmentTypes = query.employmentType?.split(",").filter(Boolean) ?? [];
  if (employmentTypes.length === 1) conditions.push(eq(jobs.employmentType, employmentTypes[0]));
  else if (employmentTypes.length > 1) conditions.push(or(...employmentTypes.map((value) => eq(jobs.employmentType, value))));
  const seniorityLevels = query.seniorityLevel?.split(",").filter(Boolean) ?? [];
  if (seniorityLevels.length === 1) conditions.push(eq(jobs.seniorityLevel, seniorityLevels[0]));
  else if (seniorityLevels.length > 1) conditions.push(or(...seniorityLevels.map((value) => eq(jobs.seniorityLevel, value))));
  if (query.locationSearch) conditions.push(like(jobs.location, `%${query.locationSearch}%`));
  return conditions;
}

function orderByFor(query: JobsQuery, scoreExpression: typeof jobs.matchScore | SQL<number | null> = jobs.matchScore) {
  const direction = query.sortOrder === "asc" ? asc : desc;
  switch (query.sortBy) {
    case "postedDate": return [sql`CASE WHEN ${jobs.postedDate} IS NULL THEN 1 ELSE 0 END`, direction(jobs.postedDate), desc(jobs.id)] as const;
    case "discoveredAt": return [direction(jobs.discoveredAt), desc(jobs.id)] as const;
    case "companyName": return [direction(companies.name), desc(jobs.discoveredAt)] as const;
    case "title": return [direction(jobs.title), desc(jobs.discoveredAt)] as const;
    default: return [sql`CASE WHEN ${scoreExpression} IS NULL THEN 1 ELSE 0 END`, direction(scoreExpression), desc(jobs.discoveredAt)] as const;
  }
}

async function presentRows(rows: Array<{ job: Parameters<typeof getMatchPresentations>[0][number]; company: { id: number; name: string; logoUrl: string | null; platform: string | null } }>, context?: Awaited<ReturnType<typeof getCurrentMatchContext>>) {
  const presentations = await getMatchPresentations(rows.map(({ job }) => job), context);
  return rows.map(({ job, company }) => {
    const presentation = presentations.get(job.id);
    if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
    return { ...job, description: null, company, ...presentation };
  });
}

export async function listJobs(query: JobsQuery) {
  const conditions = baseConditions(query);
  const requestedBands: MatchBand[] = query.matchBands ?? [];
  const scoreAware = query.sortBy === "matchScore" || query.minScore !== undefined
    || query.maxScore !== undefined || requestedBands.length > 0;
  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;
  if (!scoreAware) {
    const direction = query.sortOrder === "asc" ? asc : desc;
    const select = db.select(JOB_LIST_SELECTION).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(baseWhere);
    let rows;
    switch (query.sortBy) {
      case "postedDate": rows = await select.orderBy(sql`CASE WHEN ${jobs.postedDate} IS NULL THEN 1 ELSE 0 END`, direction(jobs.postedDate), desc(jobs.id)).limit(query.limit).offset(query.offset); break;
      case "discoveredAt": rows = await select.orderBy(direction(jobs.discoveredAt), desc(jobs.id)).limit(query.limit).offset(query.offset); break;
      case "companyName": rows = await select.orderBy(direction(companies.name), desc(jobs.discoveredAt)).limit(query.limit).offset(query.offset); break;
      case "title": rows = await select.orderBy(direction(jobs.title), desc(jobs.discoveredAt)).limit(query.limit).offset(query.offset); break;
      default: rows = await select.orderBy(desc(jobs.discoveredAt), desc(jobs.id)).limit(query.limit).offset(query.offset);
    }
    const [{ value: totalCount }] = await db.select({ value: count() }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(baseWhere);
    return { jobs: await presentRows(rows), totalCount, hasMore: query.offset + query.limit < totalCount };
  }

  const currentContext = await getCurrentMatchContext();
  const scoreConditions = [...conditions];
  let rows;
  let totalCount: number;
  if (!currentContext) {
    if (query.minScore !== undefined) scoreConditions.push(gte(jobs.matchScore, query.minScore));
    if (query.maxScore !== undefined) scoreConditions.push(lte(jobs.matchScore, query.maxScore));
    if (requestedBands.length > 0) scoreConditions.push(legacyBandCondition(requestedBands));
    const where = scoreConditions.length > 0 ? and(...scoreConditions) : undefined;
    rows = await db.select(JOB_LIST_SELECTION).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(where).orderBy(...orderByFor(query)).limit(query.limit).offset(query.offset);
    const [total] = await db.select({ value: count() }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(where);
    totalCount = total.value;
  } else {
    const join = and(eq(matchResults.jobId, jobs.id), eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint), eq(matchResults.isStale, false));
    const effectiveScore = sql<number | null>`coalesce(${matchResults.score}, ${jobs.matchScore})`;
    if (query.minScore !== undefined) scoreConditions.push(gte(effectiveScore, query.minScore));
    if (query.maxScore !== undefined) scoreConditions.push(lte(effectiveScore, query.maxScore));
    if (requestedBands.length > 0) {
      const high = requestedBands.includes("high");
      const good = requestedBands.includes("good");
      const currentBand = high && good ? gte(effectiveScore, 70) : high ? gte(effectiveScore, 85) : and(gte(effectiveScore, 70), lt(effectiveScore, 85));
      const band = or(currentBand, and(isNull(matchResults.id), legacyBandCondition(requestedBands)));
      if (band) scoreConditions.push(band);
    }
    const where = scoreConditions.length > 0 ? and(...scoreConditions) : undefined;
    rows = await db.select(JOB_LIST_SELECTION).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id))
      .leftJoin(matchResults, join).where(where).orderBy(...orderByFor(query, effectiveScore)).limit(query.limit).offset(query.offset);
    const [total] = await db.select({ value: count() }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).leftJoin(matchResults, join).where(where);
    totalCount = total.value;
  }
  return { jobs: await presentRows(rows, currentContext), totalCount, hasMore: query.offset + query.limit < totalCount };
}

export async function getJob(id: number) {
  const [row] = await db
    .select({ job: JOB_LIST_SELECTION.job, company: {
      id: companies.id,
      name: companies.name,
      logoUrl: companies.logoUrl,
      platform: companies.platform,
    } })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("Job not found", "job_not_found");

  const presentations = await getMatchPresentations([row.job]);
  const presentation = presentations.get(row.job.id);
  if (!presentation) throw new Error(`Missing match presentation for job ${row.job.id}`);
  return { ...row.job, company: row.company, ...presentation };
}

export async function updateJob(id: number, input: JobUpdate) {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.status) updateData.status = input.status;
  if (input.viewedAt) updateData.viewedAt = input.viewedAt;
  if (input.appliedAt) updateData.appliedAt = input.appliedAt;

  if (input.status === "archived") {
    updateData.archivedAt = new Date();
    updateData.archiveSource = "manual";
  } else if (input.status) {
    updateData.archivedAt = null;
    updateData.archiveSource = null;
  }
  if (input.status === "viewed" && !input.viewedAt) updateData.viewedAt = new Date();
  if (input.status === "applied" && !input.appliedAt) updateData.appliedAt = new Date();

  const [updated] = await db.update(jobs).set(updateData).where(eq(jobs.id, id)).returning();
  if (!updated) throw new NotFoundError("Job not found", "job_not_found");
  return updated;
}

export async function deleteJob(id: number): Promise<{ success: true }> {
  const deleted = await getLocalDataMaintenanceService().deleteJobs([id]);
  if (deleted === 0) throw new NotFoundError("Job not found", "job_not_found");
  return { success: true };
}

export async function getUnmatchedMatchStatus(days: number, sessionId?: string) {
  if (sessionId) {
    const session = await getAIWorkSession(sessionId);
    if (!session) throw new NotFoundError("Session not found", "session_not_found");
    return {
      sessionId: session.id, status: session.status, total: session.jobsTotal,
      completed: session.jobsCompleted, succeeded: session.jobsSucceeded,
      failed: session.jobsFailed, startedAt: session.startedAt, completedAt: session.completedAt,
    };
  }
  return { count: await getUnmatchedJobCount({ discoveredSince: new Date(Date.now() - days * DAY_MS) }), days };
}

export async function queueUnmatchedJobs(days: number) {
  const jobIds = await getUnmatchedJobIds({ discoveredSince: new Date(Date.now() - days * DAY_MS) });
  return jobIds.length === 0
    ? completeEmptyMatchSession({ triggerSource: "match_unmatched" })
    : queueMatchWork({ jobIds, triggerSource: "match_unmatched" });
}
