import { db } from "@/lib/db";
import { education } from "@/lib/db/schema";
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

    const educationData = await db
      .select()
      .from(education)
      .where(eq(education.profileId, parseInt(profileId)));

    return NextResponse.json(educationData);
  } catch (error) {
    console.error("Failed to fetch education:", error);
    return NextResponse.json(
      { error: "Failed to fetch education" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profileId, institution, degree, field, startDate, endDate, gpa, honors } = body;

    if (!profileId || !institution || !degree || !startDate) {
      return NextResponse.json(
        { error: "profileId, institution, degree, and startDate are required" },
        { status: 400 }
      );
    }

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

    return NextResponse.json(newEducation);
  } catch (error) {
    console.error("Failed to create education:", error);
    return NextResponse.json(
      { error: "Failed to create education" },
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

    await db.delete(education).where(eq(education.id, parseInt(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete education:", error);
    return NextResponse.json(
      { error: "Failed to delete education" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, institution, degree, field, startDate, endDate, gpa, honors } = body;

    if (!id || !institution || !degree || !startDate) {
      return NextResponse.json(
        { error: "id, institution, degree, and startDate are required" },
        { status: 400 }
      );
    }

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
      .where(eq(education.id, parseInt(id)))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update education:", error);
    return NextResponse.json(
      { error: "Failed to update education" },
      { status: 500 }
    );
  }
}
