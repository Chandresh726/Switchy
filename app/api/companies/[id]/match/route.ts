import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { completeEmptyMatchSession, queueMatchWork } from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { companyIdParamsSchema } from "@/lib/api/contracts/companies";
import { db } from "@/lib/db";
import { companies, jobs } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    assertAppRequest(request);
    const { id: companyId } = companyIdParamsSchema.parse(await params);
    const company = await db.select({ id: companies.id }).from(companies)
      .where(eq(companies.id, companyId)).limit(1).then((rows) => rows[0]);
    if (!company) throw new NotFoundError("Company not found", "company_not_found");
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
    return handleApiError(error, { request, fallbackMessage: "Failed to queue company jobs", fallbackCode: "company_match_failed" });
  }
}
