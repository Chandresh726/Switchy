import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, createApiRequestContext, handleApiError } from "@/lib/api";
import { companySyncBodySchema } from "@/lib/api/contracts/companies";
import { syncCompanies } from "@/lib/application/companies-service";

export async function PUT(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = companySyncBodySchema.parse(await request.json());
    return NextResponse.json(await syncCompanies(input, createApiRequestContext(request)));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to sync companies", fallbackCode: "companies_sync_failed" });
  }
}
