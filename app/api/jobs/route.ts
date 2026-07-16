import { NextRequest, NextResponse } from "next/server";

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

import {
  getCurrentMatchContext,
  getMatchPresentations,
} from "@/lib/ai/matcher/presentation";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { jobsQuerySchema, jobUpdateBodySchema } from "@/lib/api/contracts/jobs";
import { db } from "@/lib/db";
import { companies, jobs, matchResults } from "@/lib/db/schema";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

const JOB_LIST_SELECTION = {
  job: {
    id: jobs.id,
    companyId: jobs.companyId,
    externalId: jobs.externalId,
    title: jobs.title,
    description: jobs.description,
    descriptionFormat: jobs.descriptionFormat,
    url: jobs.url,
    location: jobs.location,
    locationType: jobs.locationType,
    salary: jobs.salary,
    department: jobs.department,
    employmentType: jobs.employmentType,
    seniorityLevel: jobs.seniorityLevel,
    status: jobs.status,
    postedDate: jobs.postedDate,
    discoveredAt: jobs.discoveredAt,
    updatedAt: jobs.updatedAt,
    archivedAt: jobs.archivedAt,
    archiveSource: jobs.archiveSource,
    viewedAt: jobs.viewedAt,
    appliedAt: jobs.appliedAt,
    matchScore: jobs.matchScore,
    matchReasons: jobs.matchReasons,
    matchedSkills: jobs.matchedSkills,
  },
  company: {
    id: companies.id,
    name: companies.name,
    logoUrl: companies.logoUrl,
    platform: companies.platform,
  },
} as const;

type MatchBand = "high" | "good";

function legacyBandCondition(requestedMatchBands: MatchBand[]) {
  const includesHigh = requestedMatchBands.includes("high");
  const includesGood = requestedMatchBands.includes("good");
  if (includesHigh && includesGood) return gte(jobs.matchScore, 70);
  if (includesHigh) return gte(jobs.matchScore, 85);
  if (includesGood) return and(gte(jobs.matchScore, 70), lt(jobs.matchScore, 85));
  return sql`0 = 1`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const query = jobsQuerySchema.parse(Object.fromEntries(searchParams));
    const {
      id,
      companyId,
      companyIds,
      status,
      excludeStatus,
      minScore,
      maxScore,
      locationType,
      search,
      department,
      employmentType,
      seniorityLevel,
      locationSearch,
      sortBy,
      sortOrder,
      offset,
    } = query;
    const requestedMatchBands: MatchBand[] = query.matchBands ?? [];
    const limit = id ? 1 : query.limit;

    // Build conditions array
    const conditions = [];

    // Support fetching single job by ID
    if (id) {
      conditions.push(eq(jobs.id, id));
    }

    if (companyId) {
      conditions.push(eq(jobs.companyId, companyId));
    }

    // Support multiple company IDs (comma-separated)
    if (companyIds) {
      const companyIdList = companyIds;
      if (companyIdList.length === 1) {
        conditions.push(eq(jobs.companyId, companyIdList[0]));
      } else if (companyIdList.length > 1) {
        conditions.push(
          or(...companyIdList.map((id) => eq(jobs.companyId, id)))
        );
      }
    }

    if (status) {
      conditions.push(eq(jobs.status, status));
    } else if (excludeStatus) {
      const excludedStatuses = excludeStatus;
      if (excludedStatuses.length > 0) {
        conditions.push(notInArray(jobs.status, excludedStatuses));
      }
    }

    if (locationType) {
      // Support multiple location types (comma-separated)
      const locationTypes = locationType;
      if (locationTypes.length === 1) {
        conditions.push(eq(jobs.locationType, locationTypes[0]));
      } else if (locationTypes.length > 1) {
        conditions.push(
          or(...locationTypes.map((lt) => eq(jobs.locationType, lt)))
        );
      }
    }

    if (search) {
      conditions.push(
        or(
          like(jobs.title, `%${search}%`),
          like(jobs.description, `%${search}%`)
        )
      );
    }

    if (department) {
      conditions.push(like(jobs.department, `%${department}%`));
    }

    if (employmentType) {
      // Support multiple employment types (comma-separated)
      const employmentTypes = employmentType.split(",").filter(Boolean);
      if (employmentTypes.length === 1) {
        conditions.push(eq(jobs.employmentType, employmentTypes[0]));
      } else if (employmentTypes.length > 1) {
        conditions.push(
          or(...employmentTypes.map((et) => eq(jobs.employmentType, et)))
        );
      }
    }

    if (seniorityLevel) {
      const seniorityLevels = seniorityLevel.split(",").filter(Boolean);
      if (seniorityLevels.length === 1) {
        conditions.push(eq(jobs.seniorityLevel, seniorityLevels[0]));
      } else if (seniorityLevels.length > 1) {
        conditions.push(
          or(...seniorityLevels.map((sl) => eq(jobs.seniorityLevel, sl)))
        );
      }
    }

    if (locationSearch) {
      conditions.push(like(jobs.location, `%${locationSearch}%`));
    }

    // Build the where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const buildJobsQuery = () => db
      .select(JOB_LIST_SELECTION)
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(whereClause);

    const scoreAwarePagination = sortBy === "matchScore" ||
      minScore !== undefined || maxScore !== undefined || requestedMatchBands.length > 0;
    if (!scoreAwarePagination) {
      const sortDirection = sortOrder === "asc" ? asc : desc;
      const query = buildJobsQuery();
      let jobsData;
      switch (sortBy) {
        case "postedDate":
          jobsData = await query.orderBy(
            sql`CASE WHEN ${jobs.postedDate} IS NULL THEN 1 ELSE 0 END`,
            sortDirection(jobs.postedDate),
            desc(jobs.id)
          ).limit(limit).offset(offset);
          break;
        case "discoveredAt":
          jobsData = await query.orderBy(
            sortDirection(jobs.discoveredAt),
            desc(jobs.id)
          ).limit(limit).offset(offset);
          break;
        case "companyName":
          jobsData = await query.orderBy(
            sortDirection(companies.name),
            desc(jobs.discoveredAt)
          ).limit(limit).offset(offset);
          break;
        case "title":
          jobsData = await query.orderBy(
            sortDirection(jobs.title),
            desc(jobs.discoveredAt)
          ).limit(limit).offset(offset);
          break;
        default:
          jobsData = await query.orderBy(desc(jobs.discoveredAt), desc(jobs.id))
            .limit(limit).offset(offset);
      }

      const [{ value: totalCount }] = await db.select({ value: count() })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(whereClause);
      const presentations = await getMatchPresentations(
        jobsData.map(({ job }) => job)
      );
      const presentedJobs = jobsData.map(({ job, company }) => {
        const presentation = presentations.get(job.id);
        if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
        return {
          ...job,
          description: id ? job.description : null,
          company,
          ...presentation,
        };
      });

      return NextResponse.json({
        jobs: presentedJobs,
        totalCount,
        hasMore: offset + limit < totalCount,
      });
    }

    const currentContext = await getCurrentMatchContext();
    const hasMinScore = minScore !== undefined;
    const hasMaxScore = maxScore !== undefined;

    let jobsData;
    let totalCount: number;
    if (!currentContext) {
      const scoreConditions = [...conditions];
      if (hasMinScore) scoreConditions.push(gte(jobs.matchScore, minScore));
      if (hasMaxScore) scoreConditions.push(lte(jobs.matchScore, maxScore));
      if (requestedMatchBands.length > 0) {
        scoreConditions.push(legacyBandCondition(requestedMatchBands));
      }
      const scoreWhere = scoreConditions.length > 0 ? and(...scoreConditions) : undefined;
      const scoreDirection = sortOrder === "asc" ? asc : desc;
      const scoreOrderBy = (() => {
        switch (sortBy) {
          case "postedDate":
            return [
              sql`CASE WHEN ${jobs.postedDate} IS NULL THEN 1 ELSE 0 END`,
              scoreDirection(jobs.postedDate),
              desc(jobs.id),
            ];
          case "discoveredAt":
            return [scoreDirection(jobs.discoveredAt), desc(jobs.id)];
          case "companyName":
            return [scoreDirection(companies.name), desc(jobs.discoveredAt)];
          case "title":
            return [scoreDirection(jobs.title), desc(jobs.discoveredAt)];
          default:
            return [
              sql`CASE WHEN ${jobs.matchScore} IS NULL THEN 1 ELSE 0 END`,
              scoreDirection(jobs.matchScore),
              desc(jobs.discoveredAt),
            ];
        }
      })();
      jobsData = await db.select(JOB_LIST_SELECTION)
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(scoreWhere)
        .orderBy(...scoreOrderBy)
        .limit(limit)
        .offset(offset);
      const [total] = await db.select({ value: count() })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(scoreWhere);
      totalCount = total.value;
    } else {
      const currentResultJoin = and(
        eq(matchResults.jobId, jobs.id),
        eq(matchResults.candidateFingerprint, currentContext.candidateFingerprint),
        eq(matchResults.isStale, false)
      );
      const effectiveMatchScore = sql<number | null>`coalesce(${matchResults.score}, ${jobs.matchScore})`;
      const scoreConditions = [...conditions];
      if (hasMinScore) scoreConditions.push(gte(effectiveMatchScore, minScore));
      if (hasMaxScore) scoreConditions.push(lte(effectiveMatchScore, maxScore));
      if (requestedMatchBands.length > 0) {
        const includesHigh = requestedMatchBands.includes("high");
        const includesGood = requestedMatchBands.includes("good");
        const currentBandCondition = includesHigh && includesGood
          ? gte(effectiveMatchScore, 70)
          : includesHigh
            ? gte(effectiveMatchScore, 85)
            : and(gte(effectiveMatchScore, 70), lt(effectiveMatchScore, 85));
        const bandCondition = or(
          currentBandCondition,
          and(isNull(matchResults.id), legacyBandCondition(requestedMatchBands))
        );
        if (bandCondition) scoreConditions.push(bandCondition);
      }
      const scoreWhere = scoreConditions.length > 0 ? and(...scoreConditions) : undefined;
      const scoreDirection = sortOrder === "asc" ? asc : desc;
      const scoreOrderBy = (() => {
        switch (sortBy) {
          case "postedDate":
            return [
              sql`CASE WHEN ${jobs.postedDate} IS NULL THEN 1 ELSE 0 END`,
              scoreDirection(jobs.postedDate),
              desc(jobs.id),
            ];
          case "discoveredAt":
            return [scoreDirection(jobs.discoveredAt), desc(jobs.id)];
          case "companyName":
            return [scoreDirection(companies.name), desc(jobs.discoveredAt)];
          case "title":
            return [scoreDirection(jobs.title), desc(jobs.discoveredAt)];
          default:
            return [
              sql`CASE WHEN ${effectiveMatchScore} IS NULL THEN 1 ELSE 0 END`,
              scoreDirection(effectiveMatchScore),
              desc(jobs.discoveredAt),
            ];
        }
      })();

      jobsData = await db.select(JOB_LIST_SELECTION)
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .leftJoin(matchResults, currentResultJoin)
        .where(scoreWhere)
        .orderBy(...scoreOrderBy)
        .limit(limit)
        .offset(offset);
      const [total] = await db.select({ value: count() })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .leftJoin(matchResults, currentResultJoin)
        .where(scoreWhere);
      totalCount = total.value;
    }

    const pagePresentations = await getMatchPresentations(
      jobsData.map(({ job }) => job),
      currentContext
    );
    const presentedPage = jobsData.map(({ job, company }) => {
      const presentation = pagePresentations.get(job.id);
      if (!presentation) throw new Error(`Missing match presentation for job ${job.id}`);
      return {
        ...job,
        description: id ? job.description : null,
        company,
        ...presentation,
      };
    });
    const hasMore = offset + limit < totalCount;

    return NextResponse.json({
      jobs: presentedPage,
      totalCount,
      hasMore,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch jobs", fallbackCode: "jobs_fetch_failed" });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { id, status, viewedAt, appliedAt } = jobUpdateBodySchema.parse(
      await request.json()
    );

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (status) updateData.status = status;
    if (viewedAt) updateData.viewedAt = viewedAt;
    if (appliedAt) updateData.appliedAt = appliedAt;

    if (status === "archived") {
      updateData.archivedAt = new Date();
      updateData.archiveSource = "manual";
    } else if (status) {
      updateData.archivedAt = null;
      updateData.archiveSource = null;
    }

    // Auto-set viewedAt when status changes to viewed
    if (status === "viewed" && !viewedAt) {
      updateData.viewedAt = new Date();
    }

    // Auto-set appliedAt when status changes to applied
    if (status === "applied" && !appliedAt) {
      updateData.appliedAt = new Date();
    }

    const [updated] = await db
      .update(jobs)
      .set(updateData)
      .where(eq(jobs.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError("Job not found", "job_not_found");
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update job", fallbackCode: "job_update_failed" });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    await getLocalDataMaintenanceService().deleteAllJobs();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete all jobs", fallbackCode: "jobs_delete_failed" });
  }
}
