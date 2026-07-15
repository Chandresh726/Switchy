import { NextRequest, NextResponse } from "next/server";

import {
  completeEmptyMatchSession,
  fetchCompanyJobIds,
  queueMatchWork,
} from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds } = await request.json() as { companyIds: number[] };
    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      throw new ValidationError("companyIds must be a non-empty array");
    }
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
    return handleApiError(error);
  }
}
