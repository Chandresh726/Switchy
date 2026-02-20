import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import {
  deleteProvider,
  requireProviderById,
  toProviderPublic,
  updateProviderApiKey,
} from "@/lib/ai/providers/provider-service";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PatchProviderBodySchema = z.object({
  apiKey: z.string().nullable().optional(),
});

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const provider = await requireProviderById(parsedParams.id);

    return NextResponse.json({
      ...toProviderPublic(provider),
      status: provider.apiKey ? "connected" : "missing_api_key",
    });
  } catch (error) {
    return handleAIAPIError(error, "Failed to fetch provider", "provider_fetch_failed");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const parsedBody = PatchProviderBodySchema.parse(await request.json());

    await requireProviderById(parsedParams.id);
    await updateProviderApiKey(parsedParams.id, parsedBody.apiKey);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAIAPIError(error, "Failed to update provider", "provider_update_failed");
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    await deleteProvider(parsedParams.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAIAPIError(error, "Failed to delete provider", "provider_delete_failed");
  }
}
