import { NextRequest, NextResponse } from "next/server";

import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import {
  getProviderValidationContext,
} from "@/lib/ai/providers/provider-service";
import { providerRegistry } from "@/lib/ai/providers";
import { APIValidationError, handleAIAPIError } from "@/lib/api/ai-error-handler";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const context = await getProviderValidationContext(parsedParams.id);
    const providerInstance = providerRegistry.get(context.providerType);

    if (!providerInstance) {
      throw new APIValidationError("Provider not registered", "provider_not_found", 404);
    }

    if (providerInstance.requiresApiKey && !context.provider.apiKey) {
      throw new APIValidationError("No API key configured", "missing_api_key");
    }

    const modelsResponse = await getProviderModels(parsedParams.id);
    const models = modelsResponse.models;

    if (models.length === 0) {
      throw new APIValidationError("No models available", "invalid_model");
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
    const response = handleAIAPIError(error, "Failed to validate provider", "provider_validation_failed");
    const body = (await response.json()) as { error: string; code: string; details?: unknown };

    return NextResponse.json(
      {
        valid: false,
        ...body,
      },
      {
        status: response.status,
      }
    );
  }
}
