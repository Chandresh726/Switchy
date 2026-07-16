import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import {
  childIdQuerySchema,
  profileIdQuerySchema,
  skillCreateBodySchema,
} from "@/lib/api/contracts/profile";
import { scheduleProfileRematch } from "@/lib/ai/matcher/profile-rematch";

export async function GET(request: NextRequest) {
  try {
    const { profileId } = profileIdQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const skillsData = await db
      .select()
      .from(skills)
      .where(eq(skills.profileId, profileId));

    return NextResponse.json(skillsData);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch skills", fallbackCode: "skills_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { profileId, name, category } = skillCreateBodySchema.parse(await request.json());

    const [newSkill] = await db
      .insert(skills)
      .values({
        profileId,
        name,
        category,
      })
      .returning();

    await scheduleProfileRematch();
    return NextResponse.json(newSkill);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create skill", fallbackCode: "skill_create_failed" });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { id } = childIdQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const [deleted] = await db
      .delete(skills)
      .where(eq(skills.id, id))
      .returning({ id: skills.id });
    if (!deleted) {
      throw new NotFoundError("Skill not found", "skill_not_found");
    }

    await scheduleProfileRematch();
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete skill", fallbackCode: "skill_delete_failed" });
  }
}
