import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import {
  createProvider,
  listProviders,
  toProviderPublic,
} from "@/lib/ai/providers/provider-service";
import { isAIProvider } from "@/lib/ai/providers/types";
import { APIValidationError, handleAIAPIError } from "@/lib/api/ai-error-handler";
import { upsertSettings } from "@/lib/settings/settings-service";

const CreateProviderBodySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().optional(),
});

export async function GET() {
  try {
    const providers = await listProviders();
    return NextResponse.json(providers.map(toProviderPublic));
  } catch (error) {
    return handleAIAPIError(error, "Failed to fetch providers", "providers_fetch_failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsedBody = CreateProviderBodySchema.parse(body);

    const { provider: providerType, apiKey } = parsedBody;

    if (!isAIProvider(providerType)) {
      throw new APIValidationError("Invalid provider type", "invalid_provider");
    }

    const metadata = getProviderMetadata(providerType);
    const normalizedApiKey = apiKey?.trim();

    if (metadata.requiresApiKey && !normalizedApiKey) {
      throw new APIValidationError("API key is required for this provider", "missing_api_key");
    }

    const created = await createProvider({
      provider: providerType,
      apiKey: normalizedApiKey,
    });

    let autoConfiguredDefaults = false;
    let autoConfiguredModelId: string | undefined;
    let autoConfiguredWarning: string | undefined;

    if (created.isDefault) {
      try {
        const providerModels = await getProviderModels(created.id, { forceRefresh: true });
        const firstModelId = providerModels.models[0]?.modelId;

        if (!firstModelId) {
          autoConfiguredWarning = "Provider added, but no text/chat model was available for auto-configuration.";
        } else {
          await upsertSettings([
            { key: "matcher_provider_id", value: created.id },
            { key: "resume_parser_provider_id", value: created.id },
            { key: "ai_writing_provider_id", value: created.id },
            { key: "matcher_model", value: firstModelId },
            { key: "resume_parser_model", value: firstModelId },
            { key: "ai_writing_model", value: firstModelId },
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
      ...toProviderPublic(created),
      autoConfiguredDefaults,
      autoConfiguredModelId,
      autoConfiguredWarning,
    });
  } catch (error) {
    return handleAIAPIError(error, "Failed to create provider", "provider_create_failed");
  }
}
