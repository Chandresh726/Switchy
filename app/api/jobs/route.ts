import { db } from "@/lib/db";
import { jobs, companies } from "@/lib/db/schema";
import { eq, desc, and, gte, lte, like, or, sql, asc, count, notInArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const id = searchParams.get("id");
    const companyId = searchParams.get("companyId");
    const companyIds = searchParams.get("companyIds");
    const status = searchParams.get("status");
    const excludeStatus = searchParams.get("excludeStatus");
    const minScore = searchParams.get("minScore");
    const maxScore = searchParams.get("maxScore");
    const locationType = searchParams.get("locationType");
    const search = searchParams.get("search");
    const department = searchParams.get("department");
    const employmentType = searchParams.get("employmentType");
    const seniorityLevel = searchParams.get("seniorityLevel");
    const locationSearch = searchParams.get("locationSearch");
    const sortBy = searchParams.get("sortBy") || "matchScore";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const offset = parseInt(searchParams.get("offset") || "0");
    const limit = parseInt(searchParams.get("limit") || "25");

    // Build conditions array
    const conditions = [];

    // Support fetching single job by ID
    if (id) {
      conditions.push(eq(jobs.id, parseInt(id)));
    }

    if (companyId) {
      conditions.push(eq(jobs.companyId, parseInt(companyId)));
    }

    // Support multiple company IDs (comma-separated)
    if (companyIds) {
      const companyIdList = companyIds.split(",").filter(Boolean).map((id) => parseInt(id));
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
      const excludedStatuses = excludeStatus.split(",").filter(Boolean);
      if (excludedStatuses.length > 0) {
        conditions.push(notInArray(jobs.status, excludedStatuses));
      }
    }

    if (minScore) {
      conditions.push(gte(jobs.matchScore, parseFloat(minScore)));
    }

    if (maxScore) {
      conditions.push(lte(jobs.matchScore, parseFloat(maxScore)));
    }

    if (locationType) {
      // Support multiple location types (comma-separated)
      const locationTypes = locationType.split(",").filter(Boolean);
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

    // Build sort order
    let orderByClause;
    const sortDir = sortOrder === "asc" ? asc : desc;

    switch (sortBy) {
      case "matchScore":
        // Sort nulls last for match score
        orderByClause = [
          sql`CASE WHEN ${jobs.matchScore} IS NULL THEN 1 ELSE 0 END`,
          sortDir(jobs.matchScore),
          desc(jobs.discoveredAt),
        ];
        break;
      case "postedDate":
        orderByClause = [
          sql`CASE WHEN ${jobs.postedDate} IS NULL THEN 1 ELSE 0 END`,
          sortDir(jobs.postedDate),
          desc(jobs.id),
        ];
        break;
      case "discoveredAt":
        orderByClause = [sortDir(jobs.discoveredAt), desc(jobs.id)];
        break;
      case "companyName":
        orderByClause = [sortDir(companies.name), desc(jobs.discoveredAt)];
        break;
      case "title":
        orderByClause = [sortDir(jobs.title), desc(jobs.discoveredAt)];
        break;
      default:
        orderByClause = [desc(jobs.matchScore), desc(jobs.discoveredAt)];
    }

    // Get total count for pagination
    const [{ value: totalCount }] = await db
      .select({ value: count() })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(whereClause);

    // Execute query with joins and offset-based pagination
    const jobsData = await db
      .select({
        job: jobs,
        company: {
          id: companies.id,
          name: companies.name,
          logoUrl: companies.logoUrl,
          platform: companies.platform,
        },
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(whereClause)
      .orderBy(...orderByClause)
      .limit(limit)
      .offset(offset);

    // Check if there are more results
    const hasMore = offset + limit < totalCount;

    // Transform results
    const transformedJobs = jobsData.map(({ job, company }) => ({
      ...job,
      company,
      matchReasons: job.matchReasons ? JSON.parse(job.matchReasons) : [],
      matchedSkills: job.matchedSkills ? JSON.parse(job.matchedSkills) : [],
      missingSkills: job.missingSkills ? JSON.parse(job.missingSkills) : [],
      recommendations: job.recommendations ? JSON.parse(job.recommendations) : [],
    }));

    return NextResponse.json({
      jobs: transformedJobs,
      totalCount,
      hasMore,
    });
  } catch (error) {
    console.error("Failed to fetch jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, viewedAt, appliedAt } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (status) updateData.status = status;
    if (viewedAt) updateData.viewedAt = new Date(viewedAt);
    if (appliedAt) updateData.appliedAt = new Date(appliedAt);

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

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update job:", error);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await db.delete(jobs);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete all jobs:", error);
    return NextResponse.json(
      { error: "Failed to delete all jobs" },
      { status: 500 }
    );
  }
}
