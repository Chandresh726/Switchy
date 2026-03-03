import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { handleApiError, ValidationError } from "@/lib/api";
import { db } from "@/lib/db";
import { companies, people } from "@/lib/db/schema";

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const PatchBodySchema = z.object({
  isStarred: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  mappedCompanyId: z.coerce.number().int().positive().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = ParamsSchema.parse(await params);
    const body = PatchBodySchema.parse(await request.json());

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
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
