import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError, ValidationError } from "@/lib/api";
import {
  getUnmatchedCompaniesList,
  getUnmatchedCompaniesSummary,
  mapUnmatchedCompanyGroup,
  refreshUnmatchedCompanyMappings,
  setUnmatchedCompanyIgnored,
} from "@/lib/connections/sync";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

const QuerySchema = z.object({
  summaryOnly: z.enum(["true", "false"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const PatchBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("map"),
    companyNormalized: z.string().min(1),
    mappedCompanyId: z.coerce.number().int().positive(),
  }),
  z.object({
    action: z.literal("ignore"),
    companyNormalized: z.string().min(1),
  }),
  z.object({
    action: z.literal("unignore"),
    companyNormalized: z.string().min(1),
  }),
  z.object({
    action: z.literal("refresh"),
  }),
]);

export async function GET(request: NextRequest) {
  try {
    const query = QuerySchema.parse({
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
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = PatchBodySchema.parse(await request.json());

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
    return handleApiError(error);
  }
}
