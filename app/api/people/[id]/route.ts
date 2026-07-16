import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { assertAppRequest, handleApiError, NotFoundError, ValidationError } from "@/lib/api";
import { personIdParamsSchema, personPatchBodySchema } from "@/lib/api/contracts/people";
import { db } from "@/lib/db";
import { companies, people } from "@/lib/db/schema";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const parsedParams = personIdParamsSchema.parse(await params);
    const body = personPatchBodySchema.parse(await request.json());

    if (
      body.isStarred === undefined &&
      body.notes === undefined &&
      body.email === undefined &&
      body.mappedCompanyId === undefined
    ) {
      throw new ValidationError("At least one editable field is required");
    }

    if (typeof body.mappedCompanyId === "number") {
      const [mappedCompany] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, body.mappedCompanyId));
      if (!mappedCompany) {
        throw new ValidationError("mappedCompanyId not found");
      }
    }

    const [updated] = await db
      .update(people)
      .set({
        ...(body.isStarred !== undefined ? { isStarred: body.isStarred } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.mappedCompanyId !== undefined ? { mappedCompanyId: body.mappedCompanyId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(people.id, parsedParams.id))
      .returning();

    if (!updated) {
      throw new NotFoundError("Person not found", "person_not_found");
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update person", fallbackCode: "person_update_failed" });
  }
}
