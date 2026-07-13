import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { assertAppRequest } from "@/lib/api";
import { db } from "@/lib/db";
import {
  companies,
  jobs,
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
} from "@/lib/db/schema";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();
    const { companyIds } = body as { companyIds: number[] };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const { deletedJobs, deletedCompanies } = db.transaction((tx) => {
      const scrapeSessionIds = tx
        .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
        .from(scrapeQueueItems)
        .innerJoin(scrapeSessions, eq(scrapeSessions.id, scrapeQueueItems.sessionId))
        .where(
          and(
            inArray(scrapeQueueItems.companyId, companyIds),
            eq(scrapeSessions.status, "in_progress")
          )
        )
        .all()
        .map((item) => item.sessionId);
      if (scrapeSessionIds.length > 0) {
        const stoppedAt = new Date();
        tx.update(scrapeQueueItems)
          .set({
            status: "cancelled",
            cancelRequested: true,
            completedAt: stoppedAt,
            updatedAt: stoppedAt,
          })
          .where(
            and(
              inArray(scrapeQueueItems.sessionId, scrapeSessionIds),
              eq(scrapeQueueItems.status, "queued")
            )
          )
          .run();
        tx.update(scrapeQueueItems)
          .set({ cancelRequested: true, updatedAt: stoppedAt })
          .where(
            and(
              inArray(scrapeQueueItems.sessionId, scrapeSessionIds),
              eq(scrapeQueueItems.status, "running")
            )
          )
          .run();
        tx.update(scrapeSessions)
          .set({ status: "failed", completedAt: stoppedAt })
          .where(inArray(scrapeSessions.id, scrapeSessionIds))
          .run();
      }
      const matchSessionIds = tx
        .select({ id: scrapeMatchOutbox.id })
        .from(scrapeMatchOutbox)
        .where(inArray(scrapeMatchOutbox.companyId, companyIds))
        .all()
        .map((row) => row.id);
      if (matchSessionIds.length > 0) {
        tx.delete(matchSessions)
          .where(inArray(matchSessions.id, matchSessionIds))
          .run();
      }
      tx.update(matchSessions)
        .set({ status: "failed", completedAt: new Date() })
        .where(
          and(
            inArray(matchSessions.companyId, companyIds),
            inArray(matchSessions.status, ["queued", "in_progress"])
          )
        )
        .run();
      const removedJobs = tx
        .delete(jobs)
        .where(inArray(jobs.companyId, companyIds))
        .returning({ id: jobs.id })
        .all();
      const removedCompanies = tx
        .delete(companies)
        .where(inArray(companies.id, companyIds))
        .returning({ id: companies.id })
        .all();
      return { deletedJobs: removedJobs, deletedCompanies: removedCompanies };
    }, { behavior: "immediate" });

    return NextResponse.json({
      success: true,
      deletedCompanies: deletedCompanies.length,
      deletedJobs: deletedJobs.length,
      message: `Deleted ${deletedCompanies.length} companies and ${deletedJobs.length} jobs`,
    });
  } catch (error) {
    console.error("Failed to delete companies:", error);
    return NextResponse.json(
      { error: "Failed to delete companies" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();
    const { companyIds, isActive } = body as {
      companyIds: number[];
      isActive: boolean;
    };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    if (typeof isActive !== "boolean") {
      return NextResponse.json(
        { error: "isActive must be a boolean" },
        { status: 400 }
      );
    }

    const updated = await db
      .update(companies)
      .set({ isActive, updatedAt: new Date() })
      .where(inArray(companies.id, companyIds))
      .returning({ id: companies.id });

    return NextResponse.json({
      success: true,
      updated: updated.length,
      message: `Updated ${updated.length} companies to ${isActive ? "active" : "paused"}`,
    });
  } catch (error) {
    console.error("Failed to update companies:", error);
    return NextResponse.json(
      { error: "Failed to update companies" },
      { status: 500 }
    );
  }
}
