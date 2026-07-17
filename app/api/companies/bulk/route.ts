import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyBulkActiveBodySchema, companyIdsBodySchema } from "@/lib/api/contracts/companies";
import { deleteBulkCompanies, setCompaniesActive } from "@/lib/application/companies-service";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds } = companyIdsBodySchema.parse(await request.json());
    return NextResponse.json(await deleteBulkCompanies(companyIds));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete companies", fallbackCode: "companies_bulk_delete_failed" });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds, isActive } = companyBulkActiveBodySchema.parse(await request.json());
    return NextResponse.json(await setCompaniesActive(companyIds, isActive));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update companies", fallbackCode: "companies_bulk_update_failed" });
  }
}
