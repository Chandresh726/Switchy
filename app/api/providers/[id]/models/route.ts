import { NextRequest, NextResponse } from "next/server";

import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import { handleApiError } from "@/lib/api";
import { providerModelsQuerySchema } from "@/lib/api/contracts/providers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = ProviderRouteParamsSchema.parse(await params);
    const { refresh } = providerModelsQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    const forceRefresh = refresh === "1" || refresh === "true";

    const models = await getProviderModels(id, { forceRefresh });
    return NextResponse.json(models);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch provider models", fallbackCode: "provider_models_fetch_failed" });
  }
}
