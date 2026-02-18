import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encryptApiKey } from "@/lib/encryption";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const provider = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (provider.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const p = provider[0];
    const status = p.apiKey ? "connected" : "missing_api_key";

    return NextResponse.json({
      id: p.id,
      provider: p.provider,
      isActive: p.isActive,
      isDefault: p.isDefault,
      hasApiKey: !!p.apiKey,
      status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  } catch (error) {
    console.error("Failed to fetch provider:", error);
    return NextResponse.json({ error: "Failed to fetch provider" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { apiKey } = body;

    const existing = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const encryptedApiKey = apiKey ? encryptApiKey(apiKey) : null;

    await db
      .update(aiProviders)
      .set({
        apiKey: encryptedApiKey,
        updatedAt: new Date(),
      })
      .where(eq(aiProviders.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update provider:", error);
    return NextResponse.json({ error: "Failed to update provider" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    const existing = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    await db.delete(aiProviders).where(eq(aiProviders.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete provider:", error);
    return NextResponse.json({ error: "Failed to delete provider" }, { status: 500 });
  }
}
