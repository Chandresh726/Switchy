import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { completeEmptyMatchSession, queueMatchWork } from "@/lib/ai/work-items";
import { assertAppRequest } from "@/lib/api";
import { db } from "@/lib/db";
import { companies, jobs } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    assertAppRequest(request);
    const companyId = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(companyId)) {
      return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
    }
    const company = await db.select({ id: companies.id }).from(companies)
      .where(eq(companies.id, companyId)).limit(1).then((rows) => rows[0]);
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    const jobIds = await db.select({ id: jobs.id }).from(jobs)
      .where(eq(jobs.companyId, companyId));
    if (jobIds.length === 0) {
      return NextResponse.json(
        completeEmptyMatchSession({
          triggerSource: "company_refresh",
          companyId,
        }),
        { status: 202 }
      );
    }
    const queued = queueMatchWork({
      jobIds: jobIds.map((job) => job.id),
      triggerSource: "company_refresh",
      companyId,
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    console.error("[Company Match API] POST error:", error);
    return NextResponse.json({ error: "Failed to queue company jobs" }, { status: 500 });
  }
}
