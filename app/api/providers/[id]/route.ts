import { NextRequest, NextResponse } from "next/server";

import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import {
  deleteProvider,
  requireProviderById,
  toProviderPublic,
  updateProvider,
} from "@/lib/ai/providers/provider-service";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { providerPatchBodySchema } from "@/lib/api/contracts/providers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const provider = await requireProviderById(parsedParams.id);

    return NextResponse.json({
      ...toProviderPublic(provider),
      status: provider.provider === "custom" || provider.apiKey
        ? "connected"
        : "missing_api_key",
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch provider", fallbackCode: "provider_fetch_failed" });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    assertAppRequest(request);

    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const parsedBody = providerPatchBodySchema.parse(await request.json());

    await updateProvider(parsedParams.id, parsedBody);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update provider", fallbackCode: "provider_update_failed" });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    assertAppRequest(request);

    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const deletion = await deleteProvider(parsedParams.id);
    return NextResponse.json({ success: true, ...deletion });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete provider", fallbackCode: "provider_delete_failed" });
  }
}
