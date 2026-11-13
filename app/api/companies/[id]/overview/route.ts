import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { companyIdParamsSchema, companyOverviewQuerySchema } from "@/lib/api/contracts/companies";
import { getCompanyOverview } from "@/lib/application/companies-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = companyIdParamsSchema.parse(await params);
    const { section } = companyOverviewQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await getCompanyOverview(id, new Date(), section));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch company overview", fallbackCode: "company_overview_fetch_failed" });
  }
}
