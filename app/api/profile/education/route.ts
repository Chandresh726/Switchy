import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import {
  childIdQuerySchema,
  educationWriteBodySchema,
  profileIdQuerySchema,
} from "@/lib/api/contracts/profile";
import { scheduleProfileRematch } from "@/lib/ai/matcher/profile-rematch";
import { db } from "@/lib/db";
import { education } from "@/lib/db/schema";

function parseDateValue(date: string | null) {
  if (!date) return Number.POSITIVE_INFINITY;

  const normalized = date.trim().toLowerCase();
  if (["present", "current", "now"].includes(normalized)) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByMostRecent<T extends { startDate: string | null; endDate: string | null; id: number }>(a: T, b: T) {
  return (
    parseDateValue(b.endDate) - parseDateValue(a.endDate) ||
    parseDateValue(b.startDate) - parseDateValue(a.startDate) ||
    b.id - a.id
  );
}

export async function GET(request: NextRequest) {
  try {
    const { profileId } = profileIdQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const educationData = await db
      .select()
      .from(education)
      .where(eq(education.profileId, profileId));

    return NextResponse.json(educationData.sort(sortByMostRecent));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch education", fallbackCode: "education_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = educationWriteBodySchema.extend({ profileId: profileIdQuerySchema.shape.profileId }).parse(
      await request.json()
    );
    const { profileId, institution, degree, field, startDate, endDate, gpa, honors } = body;

    const [newEducation] = await db
      .insert(education)
      .values({
        profileId,
        institution,
        degree,
        field,
        startDate,
        endDate,
        gpa,
        honors,
      })
      .returning();

    await scheduleProfileRematch();
    return NextResponse.json(newEducation);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create education", fallbackCode: "education_create_failed" });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { id } = childIdQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const [deleted] = await db
      .delete(education)
      .where(eq(education.id, id))
      .returning({ id: education.id });
    if (!deleted) {
      throw new NotFoundError("Education not found", "education_not_found");
    }

    await scheduleProfileRematch();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete education", fallbackCode: "education_delete_failed" });
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = educationWriteBodySchema.extend({ id: childIdQuerySchema.shape.id }).parse(
      await request.json()
    );
    const { id, institution, degree, field, startDate, endDate, gpa, honors } = body;

    const [updated] = await db
      .update(education)
      .set({
        institution,
        degree,
        field,
        startDate,
        endDate: endDate || null,
        gpa,
        honors,
      })
      .where(eq(education.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundError("Education not found", "education_not_found");
    }

    await scheduleProfileRematch();
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update education", fallbackCode: "education_update_failed" });
  }
}
