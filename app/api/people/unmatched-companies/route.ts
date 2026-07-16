import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";
import {
  unmatchedCompaniesQuerySchema,
  unmatchedCompanyPatchBodySchema,
} from "@/lib/api/contracts/people";
import {
  getUnmatchedCompaniesList,
  getUnmatchedCompaniesSummary,
  mapUnmatchedCompanyGroup,
  refreshUnmatchedCompanyMappings,
  setUnmatchedCompanyIgnored,
} from "@/lib/people/sync";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  try {
    const query = unmatchedCompaniesQuerySchema.parse({
      summaryOnly: request.nextUrl.searchParams.get("summaryOnly") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });

    if (query.summaryOnly === "true") {
      const summary = await getUnmatchedCompaniesSummary({
        search: query.search,
      });
      return NextResponse.json({
        summary,
        groups: [],
        totalCount: 0,
        hasMore: false,
      });
    }

    const result = await getUnmatchedCompaniesList({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch unmatched companies", fallbackCode: "unmatched_companies_fetch_failed" });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = unmatchedCompanyPatchBodySchema.parse(await request.json());

    if (body.action === "refresh") {
      const result = await refreshUnmatchedCompanyMappings();
      return NextResponse.json(result);
    }

    if (body.action === "map") {
      const [mappedCompany] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, body.mappedCompanyId))
        .limit(1);

      if (!mappedCompany) {
        throw new ValidationError("mappedCompanyId not found");
      }

      const result = await mapUnmatchedCompanyGroup(body.companyNormalized, body.mappedCompanyId);
      return NextResponse.json(result);
    }

    await setUnmatchedCompanyIgnored(body.companyNormalized, body.action === "ignore");
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update unmatched companies", fallbackCode: "unmatched_companies_update_failed" });
  }
}
