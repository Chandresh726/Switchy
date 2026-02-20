import { NextRequest, NextResponse } from "next/server";

import { AIError } from "@/lib/ai/shared/errors";
import { getProviderModels } from "@/lib/ai/providers/model-catalog";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function getStatusCode(error: AIError): number {
  switch (error.type) {
    case "provider_not_found":
      return 404;
    case "missing_api_key":
    case "invalid_model":
    case "decryption_failed":
      return 400;
    default:
      return 500;
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const refreshParam = request.nextUrl.searchParams.get("refresh");
    const forceRefresh = refreshParam === "1" || refreshParam === "true";

    const models = await getProviderModels(id, { forceRefresh });
    return NextResponse.json(models);
  } catch (error) {
    if (error instanceof AIError) {
      return NextResponse.json({ error: error.message, type: error.type }, { status: getStatusCode(error) });
    }
    return handleAIAPIError(error, "Failed to fetch provider models", "provider_models_fetch_failed");
  }
}
