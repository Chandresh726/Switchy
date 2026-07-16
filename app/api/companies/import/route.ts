import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, createApiRequestContext, handleApiError } from "@/lib/api";
import { companyImportBodySchema } from "@/lib/api/contracts/companies";
import { importCompanies } from "@/lib/application/companies-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = companyImportBodySchema.parse(await request.json());
    return NextResponse.json(await importCompanies(input, createApiRequestContext(request)));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create/import companies", fallbackCode: "companies_import_failed" });
  }
}
