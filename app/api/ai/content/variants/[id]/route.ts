import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AIContentVariantSignalSchema } from "@/lib/ai/contracts";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { numericIdParamsSchema } from "@/lib/api/contracts/matching";
import { recordVariantSignal } from "@/lib/ai/writing/content-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);
    const { id: variantId } = numericIdParamsSchema.parse(await params);
    const { action } = AIContentVariantSignalSchema.parse(await request.json());
    const updated = await recordVariantSignal(variantId, action);
    if (!updated) {
      throw new NotFoundError("Variant not found");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to record writing signal", fallbackCode: "ai_content_signal_failed" });
  }
}
