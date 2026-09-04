import { NextRequest, NextResponse } from "next/server";

import { AIContentPatchBodySchema } from "@/lib/ai/contracts";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { numericIdParamsSchema } from "@/lib/api/contracts/matching";
import { deleteGeneratedContent, saveManualVariant } from "@/lib/ai/writing/content-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const { id: parsedId } = numericIdParamsSchema.parse(await params);

    const body = AIContentPatchBodySchema.parse(await request.json());

    const content = await saveManualVariant({
      contentId: parsedId,
      content: body.content,
      userPrompt: body.userPrompt,
      parentVariantId: body.parentVariantId,
    });
    if (!content) {
      throw new NotFoundError("Content not found");
    }
    return NextResponse.json({ content });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to save content", fallbackCode: "ai_content_patch_failed" });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const { id: parsedId } = numericIdParamsSchema.parse(await params);

    const deleted = await deleteGeneratedContent(parsedId);
    if (!deleted) {
      throw new NotFoundError("Content not found", "ai_content_not_found");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete content", fallbackCode: "ai_content_delete_failed" });
  }
}
