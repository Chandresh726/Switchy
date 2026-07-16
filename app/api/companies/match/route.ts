import { NextRequest, NextResponse } from "next/server";

import {
  completeEmptyMatchSession,
  fetchCompanyJobIds,
  queueMatchWork,
} from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { matchCompanyIdsBodySchema } from "@/lib/api/contracts/matching";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds } = matchCompanyIdsBodySchema.parse(await request.json());
    const jobIds = await fetchCompanyJobIds(companyIds);
    if (jobIds.length === 0) {
      return NextResponse.json(
        completeEmptyMatchSession({ triggerSource: "manual" }),
        { status: 202 }
      );
    }
    const queued = queueMatchWork({
      jobIds,
      triggerSource: "manual",
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to queue company matches", fallbackCode: "companies_match_failed" });
  }
}
