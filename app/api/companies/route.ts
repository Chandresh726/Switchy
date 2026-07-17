import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { listCompanies } from "@/lib/application/companies-service";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await listCompanies());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch companies", fallbackCode: "companies_fetch_failed" });
  }
}
