import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiGeneratedContent, aiGenerationHistory, jobs, companies } from "@/lib/db/schema";
import { desc, eq, asc, inArray } from "drizzle-orm";

export async function GET() {
  try {
    const contents = await db
      .select({
        id: aiGeneratedContent.id,
        jobId: aiGeneratedContent.jobId,
        type: aiGeneratedContent.type,
        content: aiGeneratedContent.content,
        settingsSnapshot: aiGeneratedContent.settingsSnapshot,
        createdAt: aiGeneratedContent.createdAt,
        updatedAt: aiGeneratedContent.updatedAt,
        jobTitle: jobs.title,
        companyName: companies.name,
        companyLogoUrl: companies.logoUrl,
      })
      .from(aiGeneratedContent)
      .innerJoin(jobs, eq(aiGeneratedContent.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .orderBy(desc(aiGeneratedContent.updatedAt));

    if (contents.length === 0) {
      return NextResponse.json({ contents: [] });
    }

    const contentIds = contents.map((c) => c.id);
    const allHistory = await db
      .select()
      .from(aiGenerationHistory)
      .where(inArray(aiGenerationHistory.contentId, contentIds))
      .orderBy(asc(aiGenerationHistory.createdAt));

    const historyByContentId = new Map<number, typeof allHistory>();
    for (const h of allHistory) {
      const existing = historyByContentId.get(h.contentId) || [];
      existing.push(h);
      historyByContentId.set(h.contentId, existing);
    }

    const contentsWithHistory = contents.map((content) => ({
      ...content,
      history: (historyByContentId.get(content.id) || []).map((h) => ({
        id: h.id,
        variant: h.variant,
        userPrompt: h.userPrompt,
        createdAt: h.createdAt?.toISOString() || new Date().toISOString(),
      })),
    }));

    return NextResponse.json({ contents: contentsWithHistory });
  } catch (error) {
    console.error("[Get AI History] Error:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Get all content IDs first
    const allContent = await db.select({ id: aiGeneratedContent.id }).from(aiGeneratedContent);
    const contentIds = allContent.map((c) => c.id);

    // Delete all history entries first (foreign key constraint)
    if (contentIds.length > 0) {
      await db.delete(aiGenerationHistory).where(inArray(aiGenerationHistory.contentId, contentIds));
    }

    // Delete all content
    await db.delete(aiGeneratedContent);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Delete AI History] Error:", error);
    return NextResponse.json({ error: "Failed to clear AI history" }, { status: 500 });
  }
}
