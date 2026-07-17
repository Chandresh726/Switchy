import { NextRequest, NextResponse } from "next/server";

import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import {
  getProviderValidationContext,
} from "@/lib/ai/providers/provider-service";
import { providerRegistry } from "@/lib/ai/providers";
import { getLocalCLIStatus } from "@/lib/ai/local-cli/service";
import { isLocalCLIProvider } from "@/lib/ai/providers/types";
import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    assertAppRequest(request);

    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const context = await getProviderValidationContext(parsedParams.id);
    if (isLocalCLIProvider(context.providerType)) {
      const connection = await getLocalCLIStatus(context.providerType, { forceRefresh: true });
      if (!connection.selectable) {
        throw new ValidationError(
          connection.statusMessage || "Local provider is not ready",
          "provider_not_ready",
          400,
          {
            provider: context.provider.provider,
            connectionStatus: connection.status,
          }
        );
      }
      return NextResponse.json({
        valid: true,
        provider: context.provider.provider,
        connectionStatus: connection.status,
        ...connection,
      });
    }
    const providerInstance = providerRegistry.get(context.providerType);

    if (!providerInstance) {
      throw new ValidationError("Provider not registered", "provider_not_found", 404);
    }

    if (providerInstance.requiresApiKey && !context.provider.apiKey) {
      throw new ValidationError("No API key configured", "missing_api_key");
    }

    const modelsResponse = await getProviderModels(parsedParams.id);
    const models = modelsResponse.models;

    if (models.length === 0) {
      throw new ValidationError("No models available", "invalid_model");
    }

    providerInstance.createModel({
      config: {
        modelId: models[0].modelId,
      },
      providerConfig: {
        apiKey: context.decryptedApiKey,
      },
    });

    return NextResponse.json({
      valid: true,
      provider: context.provider.provider,
      modelsCount: models.length,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to validate provider", fallbackCode: "provider_validation_failed" });
  }
}
