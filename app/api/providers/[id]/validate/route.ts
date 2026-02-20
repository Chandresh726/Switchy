import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { decryptApiKey } from "@/lib/encryption";
import { providerRegistry } from "@/lib/ai/providers";
import { AIError } from "@/lib/ai/shared/errors";
import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import { isAIProvider } from "@/lib/ai/providers/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const RouteParamsSchema = z.object({
  id: z.string().min(1),
});

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = RouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    const { id } = parsedParams.data;

    const provider = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (provider.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const p = provider[0];

    if (!isAIProvider(p.provider)) {
      return NextResponse.json({ valid: false, error: "Provider not registered" }, { status: 400 });
    }

    const providerType = p.provider;
    const providerInstance = providerRegistry.get(providerType);

    if (!providerInstance) {
      return NextResponse.json({ valid: false, error: "Provider not registered" }, { status: 400 });
    }

    if (providerInstance.requiresApiKey && !p.apiKey) {
      return NextResponse.json({ valid: false, error: "No API key configured" }, { status: 400 });
    }

    const decryptedKey = p.apiKey ? decryptApiKey(p.apiKey) : undefined;
    const modelsResponse = await getProviderModels(id);
    const models = modelsResponse.models;

    if (models.length === 0) {
      return NextResponse.json({ valid: false, error: "No models available" }, { status: 400 });
    }

    try {
      providerInstance.createModel({
        config: {
          modelId: models[0].modelId,
        },
        providerConfig: {
          apiKey: decryptedKey,
        },
      });

      return NextResponse.json({
        valid: true,
        provider: p.provider,
        modelsCount: models.length,
      });
    } catch (error) {
      return NextResponse.json(
        {
          valid: false,
          error: error instanceof Error ? error.message : "Failed to create model",
        },
        { status: 400 }
      );
    }
  } catch (error) {
    if (error instanceof AIError) {
      const status = error.type === "provider_not_found" ? 404 : 400;
      return NextResponse.json({ valid: false, error: error.message }, { status });
    }
    console.error("Failed to validate provider:", error);
    return NextResponse.json({ error: "Failed to validate provider" }, { status: 500 });
  }
}
