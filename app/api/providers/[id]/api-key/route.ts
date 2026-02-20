import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const RouteParamsSchema = z.object({
  id: z.string().min(1),
});

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = RouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const { id } = parsedParams.data;

    const provider = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (provider.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const p = provider[0];
    
    let apiKey: string | null = null;
    if (p.apiKey) {
      try {
        apiKey = decryptApiKey(p.apiKey);
      } catch {
        console.error(`Failed to decrypt API key for provider "${p.id}"`);
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
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Failed to fetch provider:", error);
    return NextResponse.json({ error: "Failed to fetch provider" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
