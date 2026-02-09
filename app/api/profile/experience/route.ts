import { db } from "@/lib/db";
import { experience } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get("profileId");

    if (!profileId) {
      return NextResponse.json(
        { error: "profileId is required" },
        { status: 400 }
      );
    }

    const experienceData = await db
      .select()
      .from(experience)
      .where(eq(experience.profileId, parseInt(profileId)));

    return NextResponse.json(experienceData);
  } catch (error) {
    console.error("Failed to fetch experience:", error);
    return NextResponse.json(
      { error: "Failed to fetch experience" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profileId, company, title, location, startDate, endDate, description, highlights } = body;

    if (!profileId || !company || !title || !startDate) {
      return NextResponse.json(
        { error: "profileId, company, title, and startDate are required" },
        { status: 400 }
      );
    }

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

    return NextResponse.json(newExperience);
  } catch (error) {
    console.error("Failed to create experience:", error);
    return NextResponse.json(
      { error: "Failed to create experience" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await db.delete(experience).where(eq(experience.id, parseInt(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete experience:", error);
    return NextResponse.json(
      { error: "Failed to delete experience" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, company, title, location, startDate, endDate, description, highlights } = body;

    if (!id || !company || !title || !startDate) {
      return NextResponse.json(
        { error: "id, company, title, and startDate are required" },
        { status: 400 }
      );
    }

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
      .where(eq(experience.id, parseInt(id)))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update experience:", error);
    return NextResponse.json(
      { error: "Failed to update experience" },
      { status: 500 }
    );
  }
}
