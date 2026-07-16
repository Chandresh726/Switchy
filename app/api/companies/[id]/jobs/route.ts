import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyIdParamsSchema } from "@/lib/api/contracts/companies";
import { deleteCompanyJobs } from "@/lib/application/companies-service";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppRequest(request);
    const { id } = companyIdParamsSchema.parse(await params);
    return NextResponse.json(await deleteCompanyJobs(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete jobs", fallbackCode: "company_jobs_delete_failed" });
  }
}
