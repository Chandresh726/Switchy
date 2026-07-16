import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";
import { manualPersonBodySchema, peopleListQuerySchema } from "@/lib/api/contracts/people";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { createManualPerson, deleteAllPeople, getPeopleList } from "@/lib/people/sync";

export async function GET(request: NextRequest) {
  try {
    const query = peopleListQuerySchema.parse({
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      companyId: request.nextUrl.searchParams.get("companyId") ?? undefined,
      source: request.nextUrl.searchParams.get("source") ?? undefined,
      starred: request.nextUrl.searchParams.get("starred") ?? undefined,
      active: request.nextUrl.searchParams.get("active") ?? undefined,
      unmatched: request.nextUrl.searchParams.get("unmatched") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      sortBy: request.nextUrl.searchParams.get("sortBy") ?? undefined,
      sortOrder: request.nextUrl.searchParams.get("sortOrder") ?? undefined,
    });

    const result = await getPeopleList({
      search: query.search,
      companyId: query.companyId,
      source: query.source ?? "all",
      starred: query.starred ? query.starred === "true" : undefined,
      active: query.active === "all" ? "all" : query.active ? query.active === "true" : true,
      unmatched: query.unmatched ? query.unmatched === "true" : undefined,
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch people", fallbackCode: "people_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = manualPersonBodySchema.parse(await request.json());
    if (typeof body.mappedCompanyId === "number") {
      const [mappedCompany] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, body.mappedCompanyId))
        .limit(1);

      if (!mappedCompany) {
        throw new ValidationError("mappedCompanyId not found");
      }
    }

    const person = await createManualPerson({
      fullName: body.fullName,
      firstName: body.firstName,
      lastName: body.lastName,
      profileUrl: body.profileUrl,
      email: body.email || null,
      companyRaw: body.companyRaw,
      position: body.position,
      notes: body.notes,
      mappedCompanyId: body.mappedCompanyId ?? null,
    });
    return NextResponse.json(person);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create person", fallbackCode: "person_create_failed" });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const result = await deleteAllPeople();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to clear people", fallbackCode: "people_clear_failed" });
  }
}
