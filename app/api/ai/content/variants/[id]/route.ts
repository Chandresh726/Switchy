import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AIContentVariantSignalSchema, ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import { assertAppRequest } from "@/lib/api";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";
import { recordVariantSignal } from "@/lib/ai/writing/content-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);
    const { id } = ProviderRouteParamsSchema.parse(await params);
    const variantId = Number.parseInt(id, 10);
    if (!Number.isInteger(variantId) || variantId < 1) {
      return NextResponse.json({ error: "Invalid id", code: "invalid_id" }, { status: 400 });
    }
    const { action } = AIContentVariantSignalSchema.parse(await request.json());
    const updated = await recordVariantSignal(variantId, action);
    if (!updated) {
      return NextResponse.json({ error: "Variant not found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAIAPIError(error, "Failed to record writing signal", "ai_content_signal_failed");
  }
}
