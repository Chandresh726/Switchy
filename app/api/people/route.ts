import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError, ValidationError } from "@/lib/api";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { createManualPerson, deleteAllPeople, getPeopleList } from "@/lib/people/sync";

const PeopleQuerySchema = z.object({
  search: z.string().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  source: z.enum(["linkedin", "apollo", "manual", "all"]).optional(),
  starred: z.enum(["true", "false"]).optional(),
  active: z.enum(["true", "false", "all"]).optional(),
  unmatched: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.enum(["lastSeenAt", "fullName", "createdAt", "isStarred"]).optional().default("lastSeenAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export async function GET(request: NextRequest) {
  try {
    const query = PeopleQuerySchema.parse({
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
    return handleApiError(error);
  }
}

const ManualPersonSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  profileUrl: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  companyRaw: z.string().trim().optional(),
  position: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
  mappedCompanyId: z.coerce.number().int().positive().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const body = ManualPersonSchema.parse(await request.json());
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
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const result = await deleteAllPeople();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
