import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { AIContentPatchBodySchema, ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import { assertAppRequest } from "@/lib/api";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";
import { db } from "@/lib/db";
import { aiGeneratedContent, aiGenerationHistory } from "@/lib/db/schema";
import { saveManualVariant } from "@/lib/ai/writing/content-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const parsedId = parseInt(parsedParams.id, 10);
    if (Number.isNaN(parsedId)) {
      return NextResponse.json({ error: "Invalid id", code: "invalid_id" }, { status: 400 });
    }

    const body = AIContentPatchBodySchema.parse(await request.json());

    const content = await saveManualVariant({
      contentId: parsedId,
      content: body.content,
      userPrompt: body.userPrompt,
      parentVariantId: body.parentVariantId,
    });
    if (!content) {
      return NextResponse.json({ error: "Content not found", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ content });
  } catch (error) {
    return handleAIAPIError(error, "Failed to save content", "ai_content_patch_failed");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const parsedId = parseInt(parsedParams.id, 10);
    if (Number.isNaN(parsedId)) {
      return NextResponse.json({ error: "Invalid id", code: "invalid_id" }, { status: 400 });
    }

    await db.delete(aiGenerationHistory).where(eq(aiGenerationHistory.contentId, parsedId));
    await db.delete(aiGeneratedContent).where(eq(aiGeneratedContent.id, parsedId));

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAIAPIError(error, "Failed to delete content", "ai_content_delete_failed");
  }
}
