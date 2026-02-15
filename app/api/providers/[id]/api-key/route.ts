import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";
import { eq } from "drizzle-orm";

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
    
    let apiKey: string | null = null;
    if (p.apiKey) {
      try {
        apiKey = decryptApiKey(p.apiKey);
      } catch (e) {
        console.error("Failed to decrypt API key:", e);
        apiKey = null;
      }
    }

    return NextResponse.json({
      id: p.id,
      provider: p.provider,
      isActive: p.isActive,
      isDefault: p.isDefault,
      hasApiKey: !!p.apiKey,
      apiKey,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  } catch (error) {
    console.error("Failed to fetch provider:", error);
    return NextResponse.json({ error: "Failed to fetch provider" }, { status: 500 });
  }
}
