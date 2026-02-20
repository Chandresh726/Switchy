import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { AIContentPatchBodySchema, ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";
import { db } from "@/lib/db";
import { aiGeneratedContent, aiGenerationHistory } from "@/lib/db/schema";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const parsedId = parseInt(parsedParams.id, 10);
    if (Number.isNaN(parsedId)) {
      return NextResponse.json({ error: "Invalid id", code: "invalid_id" }, { status: 400 });
    }

    const body = AIContentPatchBodySchema.parse(await request.json());

    const existingContent = await db
      .select()
      .from(aiGeneratedContent)
      .where(eq(aiGeneratedContent.id, parsedId))
      .limit(1);

    if (!existingContent[0]) {
      return NextResponse.json({ error: "Content not found", code: "not_found" }, { status: 404 });
    }

    await db
      .update(aiGeneratedContent)
      .set({
        content: body.content,
        updatedAt: new Date(),
      })
      .where(eq(aiGeneratedContent.id, parsedId));

    await db.insert(aiGenerationHistory).values({
      contentId: parsedId,
      variant: body.content,
      userPrompt: body.userPrompt || "Manual edit",
      parentVariantId: null,
    });

    const historyResults = await db
      .select()
      .from(aiGenerationHistory)
      .where(eq(aiGenerationHistory.contentId, parsedId))
      .orderBy(asc(aiGenerationHistory.createdAt));

    return NextResponse.json({
      content: {
        id: parsedId,
        jobId: existingContent[0].jobId,
        type: existingContent[0].type,
        content: body.content,
        settingsSnapshot: existingContent[0].settingsSnapshot,
        createdAt: existingContent[0].createdAt
          ? existingContent[0].createdAt.toISOString()
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: historyResults.map((entry) => ({
          id: entry.id,
          variant: entry.variant,
          userPrompt: entry.userPrompt,
          createdAt: entry.createdAt ? entry.createdAt.toISOString() : new Date().toISOString(),
        })),
      },
    });
  } catch (error) {
    return handleAIAPIError(error, "Failed to save content", "ai_content_patch_failed");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
