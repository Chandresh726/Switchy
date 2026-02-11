import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, parseInt(id)));

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json(company);
  } catch (error) {
    console.error("Failed to fetch company:", error);
    return NextResponse.json(
      { error: "Failed to fetch company" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, careersUrl, logoUrl, isActive, platform, boardToken } = body;

    const [updated] = await db
      .update(companies)
      .set({
        name,
        careersUrl,
        logoUrl,
        isActive,
        platform,
        boardToken,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, parseInt(id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update company:", error);
    return NextResponse.json(
      { error: "Failed to update company" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.careersUrl !== undefined) updateData.careersUrl = body.careersUrl;
    if (body.logoUrl !== undefined) updateData.logoUrl = body.logoUrl;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.platform !== undefined) updateData.platform = body.platform;
    if (body.boardToken !== undefined) updateData.boardToken = body.boardToken;

    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(eq(companies.id, parseInt(id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update company:", error);
    return NextResponse.json(
      { error: "Failed to update company" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(companies).where(eq(companies.id, parseInt(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete company:", error);
    return NextResponse.json(
      { error: "Failed to delete company" },
      { status: 500 }
    );
  }
}
