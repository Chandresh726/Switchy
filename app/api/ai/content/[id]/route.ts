import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiGeneratedContent, aiGenerationHistory } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json();
    const { content: newContent, userPrompt } = body;

    if (!newContent || typeof newContent !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    // Get existing content
    const existingContent = await db.select()
      .from(aiGeneratedContent)
      .where(eq(aiGeneratedContent.id, parsedId))
      .limit(1);

    if (!existingContent[0]) {
      return NextResponse.json({ error: "Content not found" }, { status: 404 });
    }

    // Update main content
    await db.update(aiGeneratedContent)
      .set({
        content: newContent,
        updatedAt: new Date(),
      })
      .where(eq(aiGeneratedContent.id, parsedId));

    // Add new history entry for this edit
    await db.insert(aiGenerationHistory).values({
      contentId: parsedId,
      variant: newContent,
      userPrompt: userPrompt || "Manual edit",
      parentVariantId: null,
    });

    // Get updated history
    const historyResults = await db.select()
      .from(aiGenerationHistory)
      .where(eq(aiGenerationHistory.contentId, parsedId))
      .orderBy(asc(aiGenerationHistory.createdAt));

    return NextResponse.json({
      content: {
        id: parsedId,
        jobId: existingContent[0].jobId,
        type: existingContent[0].type,
        content: newContent,
        settingsSnapshot: existingContent[0].settingsSnapshot,
        createdAt: existingContent[0].createdAt ? existingContent[0].createdAt.toISOString() : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: historyResults.map((h) => ({
          id: h.id,
          variant: h.variant,
          userPrompt: h.userPrompt,
          createdAt: h.createdAt ? h.createdAt.toISOString() : new Date().toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("[Patch AI Content] Error:", error);
    return NextResponse.json({ error: "Failed to save content" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Delete history entries first (foreign key constraint)
    await db.delete(aiGenerationHistory).where(eq(aiGenerationHistory.contentId, parsedId));

    // Delete the content
    await db.delete(aiGeneratedContent).where(eq(aiGeneratedContent.id, parsedId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Delete AI Content] Error:", error);
    return NextResponse.json({ error: "Failed to delete content" }, { status: 500 });
  }
}
