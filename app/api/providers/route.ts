import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import { isAIProvider } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { aiProviders, settings } from "@/lib/db/schema";
import { encryptApiKey } from "@/lib/encryption";

const CreateProviderBodySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().optional(),
});

async function upsertSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value, updatedAt: new Date() });
  }
}

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
    const parsedBody = CreateProviderBodySchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json({ error: "Provider type is required" }, { status: 400 });
    }

    const { provider: providerType, apiKey } = parsedBody.data;

    if (!isAIProvider(providerType)) {
      return NextResponse.json({ error: "Invalid provider type" }, { status: 400 });
    }

    const metadata = getProviderMetadata(providerType);

    let encryptedApiKey: string | undefined;
    const normalizedApiKey = apiKey?.trim();
    if (normalizedApiKey && metadata.requiresApiKey) {
      encryptedApiKey = encryptApiKey(normalizedApiKey);
    }

    const existingProviders = await db.select().from(aiProviders);
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

    let autoConfiguredDefaults = false;
    let autoConfiguredModelId: string | undefined;
    let autoConfiguredWarning: string | undefined;

    if (isFirstProvider) {
      try {
        const providerModels = await getProviderModels(newProvider[0].id, { forceRefresh: true });
        const firstModelId = providerModels.models[0]?.modelId;

        if (!firstModelId) {
          autoConfiguredWarning = "Provider added, but no text/chat model was available for auto-configuration.";
        } else {
          await Promise.all([
            upsertSetting("matcher_provider_id", newProvider[0].id),
            upsertSetting("resume_parser_provider_id", newProvider[0].id),
            upsertSetting("ai_writing_provider_id", newProvider[0].id),
            upsertSetting("matcher_model", firstModelId),
            upsertSetting("resume_parser_model", firstModelId),
            upsertSetting("ai_writing_model", firstModelId),
          ]);

          autoConfiguredDefaults = true;
          autoConfiguredModelId = firstModelId;
        }
      } catch (error) {
        autoConfiguredWarning = error instanceof Error
          ? `Provider added, but defaults could not be auto-configured: ${error.message}`
          : "Provider added, but defaults could not be auto-configured.";
      }
    }

    return NextResponse.json({
      id: newProvider[0].id,
      provider: newProvider[0].provider,
      isActive: newProvider[0].isActive,
      isDefault: newProvider[0].isDefault,
      hasApiKey: !!encryptedApiKey,
      createdAt: newProvider[0].createdAt,
      updatedAt: newProvider[0].updatedAt,
      autoConfiguredDefaults,
      autoConfiguredModelId,
      autoConfiguredWarning,
    });
  } catch (error) {
    console.error("Failed to create provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
