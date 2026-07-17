import { NextRequest, NextResponse } from "next/server";

import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import { getProviderMetadata } from "@/lib/ai/providers/metadata";
import {
  createProvider,
  listProviders,
  toProviderPublic,
} from "@/lib/ai/providers/provider-service";
import { isAIProvider, isLocalCLIProvider } from "@/lib/ai/providers/types";
import {
  getCachedLocalCLIStatus,
  getLocalCLIStatus,
} from "@/lib/ai/local-cli/service";
import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";
import { providerCreateBodySchema } from "@/lib/api/contracts/providers";
import { upsertSettings } from "@/lib/settings/settings-service";

export async function GET(request: NextRequest) {
  try {
    const providers = await listProviders();
    return NextResponse.json(await Promise.all(providers.map(async (provider) => {
      const publicProvider = toProviderPublic(provider);
      if (!isLocalCLIProvider(provider.provider)) return publicProvider;
      const connection = getCachedLocalCLIStatus(provider.provider) ??
        await getLocalCLIStatus(provider.provider);
      return {
        ...publicProvider,
        connectionStatus: connection.status,
        selectable: connection.selectable,
        cliVersion: connection.cliVersion,
        statusMessage: connection.statusMessage,
        lastCheckedAt: connection.lastCheckedAt,
      };
    })));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch providers", fallbackCode: "providers_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();
    const parsedBody = providerCreateBodySchema.parse(body);

    const { provider: providerType, apiKey } = parsedBody;

    if (!isAIProvider(providerType)) {
      throw new ValidationError("Invalid provider type", "invalid_provider");
    }

    const metadata = getProviderMetadata(providerType);
    const normalizedApiKey = apiKey?.trim();

    if (metadata.requiresApiKey && !normalizedApiKey) {
      throw new ValidationError("API key is required for this provider", "missing_api_key");
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
            { key: "job_analysis_provider_id", value: created.id },
            { key: "matcher_provider_id", value: created.id },
            { key: "resume_parser_provider_id", value: created.id },
            { key: "ai_writing_provider_id", value: created.id },
            { key: "job_analysis_model", value: firstModelId },
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
    return handleApiError(error, { request, fallbackMessage: "Failed to create provider", fallbackCode: "provider_create_failed" });
  }
}
