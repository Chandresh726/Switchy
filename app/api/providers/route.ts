import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { encryptApiKey } from "@/lib/encryption";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const providers = await db.select().from(aiProviders).orderBy(aiProviders.createdAt);
    
    const providersWithoutKeys = providers.map((p) => ({
      id: p.id,
      provider: p.provider,
      isActive: p.isActive,
      isDefault: p.isDefault,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      hasApiKey: !!p.apiKey,
    }));

    return NextResponse.json(providersWithoutKeys);
  } catch (error) {
    console.error("Failed to fetch providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider: providerType, apiKey } = body;

    if (!providerType) {
      return NextResponse.json({ error: "Provider type is required" }, { status: 400 });
    }

    const metadata = getProviderMetadata(providerType);
    if (!metadata) {
      return NextResponse.json({ error: "Invalid provider type" }, { status: 400 });
    }

    let encryptedApiKey: string | undefined;
    if (apiKey && metadata.requiresApiKey) {
      encryptedApiKey = encryptApiKey(apiKey);
    }

    const existingProviders = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.provider, providerType));

    const isFirstProvider = existingProviders.length === 0;

    const newProvider = await db
      .insert(aiProviders)
      .values({
        id: randomUUID(),
        provider: providerType,
        apiKey: encryptedApiKey,
        isActive: true,
        isDefault: isFirstProvider,
      })
      .returning();

    return NextResponse.json({
      id: newProvider[0].id,
      provider: newProvider[0].provider,
      isActive: newProvider[0].isActive,
      isDefault: newProvider[0].isDefault,
      hasApiKey: !!encryptedApiKey,
      createdAt: newProvider[0].createdAt,
      updatedAt: newProvider[0].updatedAt,
    });
  } catch (error) {
    console.error("Failed to create provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
