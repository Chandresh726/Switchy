import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { companyAliasesQuerySchema } from "@/lib/api/contracts/people";
import { listCompanyAliases } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const query = companyAliasesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listCompanyAliases(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch company aliases", fallbackCode: "company_aliases_fetch_failed" });
  }
}
