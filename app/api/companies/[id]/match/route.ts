import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyIdParamsSchema } from "@/lib/api/contracts/companies";
import { queueCompanyMatch } from "@/lib/application/companies-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppRequest(request);
    const { id } = companyIdParamsSchema.parse(await params);
    return NextResponse.json(await queueCompanyMatch(id), { status: 202 });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to queue company jobs", fallbackCode: "company_match_failed" });
  }
}
