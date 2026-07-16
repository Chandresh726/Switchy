import { db } from "@/lib/db";
import { experience } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import {
  childIdQuerySchema,
  experienceWriteBodySchema,
  profileIdQuerySchema,
} from "@/lib/api/contracts/profile";
import { scheduleProfileRematch } from "@/lib/ai/matcher/profile-rematch";

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

    const experienceData = await db
      .select()
      .from(experience)
      .where(eq(experience.profileId, profileId));

    return NextResponse.json(experienceData.sort(sortByMostRecent));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch experience", fallbackCode: "experience_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = experienceWriteBodySchema.extend({ profileId: profileIdQuerySchema.shape.profileId }).parse(
      await request.json()
    );
    const { profileId, company, title, location, startDate, endDate, description, highlights } = body;

    const [newExperience] = await db
      .insert(experience)
      .values({
        profileId,
        company,
        title,
        location,
        startDate,
        endDate,
        description,
        highlights: highlights ? JSON.stringify(highlights) : null,
      })
      .returning();

    await scheduleProfileRematch();
    return NextResponse.json(newExperience);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create experience", fallbackCode: "experience_create_failed" });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { id } = childIdQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const [deleted] = await db
      .delete(experience)
      .where(eq(experience.id, id))
      .returning({ id: experience.id });
    if (!deleted) {
      throw new NotFoundError("Experience not found", "experience_not_found");
    }

    await scheduleProfileRematch();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete experience", fallbackCode: "experience_delete_failed" });
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = experienceWriteBodySchema.extend({ id: childIdQuerySchema.shape.id }).parse(
      await request.json()
    );
    const { id, company, title, location, startDate, endDate, description, highlights } = body;

    const [updated] = await db
      .update(experience)
      .set({
        company,
        title,
        location,
        startDate,
        endDate: endDate || null,
        description,
        highlights: highlights ? JSON.stringify(highlights) : null,
      })
      .where(eq(experience.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundError("Experience not found", "experience_not_found");
    }

    await scheduleProfileRematch();
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update experience", fallbackCode: "experience_update_failed" });
  }
}
