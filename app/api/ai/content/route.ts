import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getAIClient, getAIGenerationOptions } from "@/lib/ai/client";
import { db } from "@/lib/db";
import { settings, aiGeneratedContent, aiGenerationHistory } from "@/lib/db/schema";
import { fetchCandidateProfile, fetchJobWithCompany } from "@/lib/ai/writing/utils";
import { COVER_LETTER_SYSTEM_PROMPT, buildCoverLetterPromptFromProfileData, type CoverLetterSettings } from "@/lib/ai/prompts/cover-letter";
import { REFERRAL_SYSTEM_PROMPT, buildReferralPromptFromProfileData, type ReferralSettings } from "@/lib/ai/prompts/referral";
import type { ContentResponse } from "@/lib/ai/writing/types";
import { eq, desc, asc, and, sql } from "drizzle-orm";

async function getSettingsMap(): Promise<Map<string, string>> {
  const settingsRecords = await db.select().from(settings);
  const map = new Map<string, string>();
  for (const s of settingsRecords) {
    if (s.value !== null) {
      map.set(s.key, s.value);
    }
  }
  return map;
}

async function getCoverLetterSettings(settingsMap: Map<string, string>): Promise<CoverLetterSettings> {
  const focusRaw = settingsMap.get("cover_letter_focus") || '["skills","experience","cultural_fit"]';
  let focus: string | string[];
  try {
    focus = JSON.parse(focusRaw);
    if (!Array.isArray(focus)) {
      focus = [focus];
    }
  } catch {
    focus = ["skills", "experience", "cultural_fit"];
  }
  return {
    tone: settingsMap.get("cover_letter_tone") || "professional",
    length: settingsMap.get("cover_letter_length") || "medium",
    focus,
  };
}

async function getReferralSettings(settingsMap: Map<string, string>): Promise<ReferralSettings> {
  return {
    tone: settingsMap.get("referral_tone") || "professional",
    length: settingsMap.get("referral_length") || "medium",
  };
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return new Date().toISOString();
  return date.toISOString();
}

/**
 * Detect placeholders in text that should not be present
 * Returns array of found placeholders or empty array if none found
 */
function detectPlaceholders(text: string): string[] {
  const placeholderPatterns = [
    /\[.*?\]/g,  // [Your Name], [Hiring Manager], etc.
    /\{.*?\}/g,  // {Your Name}, {Date}, etc.
    /<.*?>/g,    // <Your Name>, <Date>, etc.
    /\(.*?\)/g,  // (Your Name), (Date) - sometimes used for placeholders
  ];
  
  const found: string[] = [];
  for (const pattern of placeholderPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return [...new Set(found)]; // Remove duplicates
}

/**
 * Build conversation context for follow-up requests
 * Shows the AI what was previously generated and what the user requested
 */
function buildConversationContext(
  history: Array<{ variant: string; userPrompt: string | null }>,
  currentRequest: string
): string {
  if (history.length === 0) {
    return currentRequest;
  }

  let context = "=== CONVERSATION HISTORY ===\n\n";
  
  history.forEach((entry, index) => {
    const turn = index + 1;
    if (entry.userPrompt && entry.userPrompt !== "Manual edit") {
      context += `Turn ${turn}:\n`;
      context += `User Request: ${entry.userPrompt}\n`;
      context += `Your Response:\n${entry.variant}\n\n`;
    }
  });

  context += "=== CURRENT REQUEST ===\n";
  context += `${currentRequest}\n\n`;
  context += "=== INSTRUCTIONS ===\n";
  context += "Based on the conversation history above and the current request, generate a new version. ";
  context += "Consider what has already been done and apply the new changes. ";
  context += "Maintain the context from previous turns while making the requested modifications.\n";

  return context;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const type = searchParams.get("type");

    if (!jobId || !type) {
      return NextResponse.json({ error: "jobId and type are required" }, { status: 400 });
    }

    if (type !== "cover_letter" && type !== "referral") {
      return NextResponse.json({ error: "type must be cover_letter or referral" }, { status: 400 });
    }

    const parsedJobId = parseInt(jobId, 10);
    if (isNaN(parsedJobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }

    const contentResults = await db.select()
      .from(aiGeneratedContent)
      .where(and(eq(aiGeneratedContent.jobId, parsedJobId), eq(aiGeneratedContent.type, type)))
      .orderBy(desc(aiGeneratedContent.updatedAt))
      .limit(1);

    const content = contentResults[0];

    if (!content) {
      return NextResponse.json({ exists: false, content: null }, { status: 200 });
    }

    const historyResults = await db.select()
      .from(aiGenerationHistory)
      .where(eq(aiGenerationHistory.contentId, content.id))
      .orderBy(asc(aiGenerationHistory.createdAt));

    const response: ContentResponse = {
      id: content.id,
      jobId: content.jobId,
      type: content.type,
      content: content.content,
      settingsSnapshot: content.settingsSnapshot,
      createdAt: formatDate(content.createdAt),
      updatedAt: formatDate(content.updatedAt),
      history: historyResults.map((h) => ({
        id: h.id,
        variant: h.variant,
        userPrompt: h.userPrompt,
        createdAt: formatDate(h.createdAt),
      })),
    };

    return NextResponse.json({ exists: true, content: response });
  } catch (error) {
    console.error("[Get AI Content] Error:", error);
    return NextResponse.json({ error: "Failed to get content" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, type, userPrompt: modificationPrompt } = body;

    if (!jobId || !type) {
      return NextResponse.json({ error: "jobId and type are required" }, { status: 400 });
    }

    if (type !== "cover_letter" && type !== "referral") {
      return NextResponse.json({ error: "type must be cover_letter or referral" }, { status: 400 });
    }

    const parsedJobId = parseInt(jobId, 10);
    if (isNaN(parsedJobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }

    const [jobData, profileData, settingsMap] = await Promise.all([
      fetchJobWithCompany(parsedJobId),
      fetchCandidateProfile(),
      getSettingsMap(),
    ]);

    if (!jobData) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!profileData) {
      return NextResponse.json({ error: "Profile not found. Please set up your profile first." }, { status: 400 });
    }

    const aiWritingModel = settingsMap.get("ai_writing_model") || "gemini-3-flash-preview";
    const aiWritingReasoningEffort = settingsMap.get("ai_writing_reasoning_effort") || "medium";

    const model = await getAIClient(aiWritingModel, aiWritingReasoningEffort);
    const providerOptions = await getAIGenerationOptions(aiWritingModel, aiWritingReasoningEffort);

    let systemPrompt: string;
    let userPrompt: string;
    let settingsSnapshot: string;
    let conversationHistory: Array<{ variant: string; userPrompt: string | null }> = [];

    // Fetch existing content and history if this is a modification request
    if (modificationPrompt) {
      const existingResults = await db.select()
        .from(aiGeneratedContent)
        .where(and(eq(aiGeneratedContent.jobId, parsedJobId), eq(aiGeneratedContent.type, type)))
        .limit(1);

      if (existingResults[0]) {
        const historyResults = await db.select()
          .from(aiGenerationHistory)
          .where(eq(aiGenerationHistory.contentId, existingResults[0].id))
          .orderBy(asc(aiGenerationHistory.createdAt));
        
        conversationHistory = historyResults.map(h => ({
          variant: h.variant,
          userPrompt: h.userPrompt,
        }));
      }
    }

    if (type === "cover_letter") {
      const coverLetterSettings = await getCoverLetterSettings(settingsMap);
      settingsSnapshot = JSON.stringify(coverLetterSettings);

      systemPrompt = COVER_LETTER_SYSTEM_PROMPT.replace("{tone}", coverLetterSettings.tone);

      let promptText = buildCoverLetterPromptFromProfileData(
        jobData.title,
        jobData.companyName,
        jobData.description || "",
        profileData,
        coverLetterSettings,
        jobData.url,
        jobData.externalId
      );

      if (modificationPrompt) {
        const modificationContext = buildConversationContext(conversationHistory, modificationPrompt);
        promptText += `\n\n## Modification Request\n${modificationContext}\n\nPlease provide the updated cover letter based on the above request and conversation history.`;
      }

      userPrompt = promptText;
    } else {
      const referralSettings = await getReferralSettings(settingsMap);
      settingsSnapshot = JSON.stringify(referralSettings);

      systemPrompt = REFERRAL_SYSTEM_PROMPT.replace("{tone}", referralSettings.tone);

      let promptText = buildReferralPromptFromProfileData(
        jobData.title,
        jobData.companyName,
        profileData,
        referralSettings,
        jobData.url,
        jobData.externalId
      );

      if (modificationPrompt) {
        const modificationContext = buildConversationContext(conversationHistory, modificationPrompt);
        promptText += `\n\n## Modification Request\n${modificationContext}\n\nPlease provide the updated referral message based on the above request and conversation history.`;
      }

      userPrompt = promptText;
    }

    // Generate with retry logic for placeholder detection
    let text: string;
    const maxRetries = 2;
    let retryCount = 0;
    
    while (true) {
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        ...providerOptions,
      });
      
      text = result.text;
      
      // Check for placeholders
      const placeholders = detectPlaceholders(text);
      if (placeholders.length === 0) {
        break; // No placeholders found, we're good
      }
      
      if (retryCount >= maxRetries) {
        console.warn(`[Generate AI Content] Placeholders found after ${maxRetries} retries:`, placeholders);
        // Continue with the text but log the warning
        break;
      }
      
      console.log(`[Generate AI Content] Retry ${retryCount + 1}: Placeholders detected:`, placeholders);
      retryCount++;
      
      // Add stronger instruction to avoid placeholders
      userPrompt += `\n\nIMPORTANT: Your previous response contained placeholders: ${placeholders.join(", ")}. Please rewrite WITHOUT using any bracketed placeholders like [Name], [Date], etc. Use actual values or omit them entirely.`;
    }

    const existingResults = await db.select()
      .from(aiGeneratedContent)
      .where(and(eq(aiGeneratedContent.jobId, parsedJobId), eq(aiGeneratedContent.type, type)))
      .limit(1);

    let contentId: number;

    if (existingResults[0]) {
      await db.update(aiGeneratedContent)
        .set({
          content: text,
          settingsSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(aiGeneratedContent.id, existingResults[0].id));

      contentId = existingResults[0].id;
    } else {
      const result = await db.insert(aiGeneratedContent).values({
        jobId: parsedJobId,
        type,
        content: text,
        settingsSnapshot,
      });
      contentId = result.lastInsertRowid as number;
    }

    await db.insert(aiGenerationHistory).values({
      contentId,
      variant: text,
      userPrompt: modificationPrompt || null,
      parentVariantId: null,
    });

    const newHistoryResults = await db.select()
      .from(aiGenerationHistory)
      .where(eq(aiGenerationHistory.contentId, contentId))
      .orderBy(asc(aiGenerationHistory.createdAt));

    return NextResponse.json({
      content: {
        id: contentId,
        jobId: parsedJobId,
        type,
        content: text,
        settingsSnapshot,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: newHistoryResults.map((h) => ({
          id: h.id,
          variant: h.variant,
          userPrompt: h.userPrompt,
          createdAt: formatDate(h.createdAt),
        })),
      },
    });
  } catch (error) {
    console.error("[Generate AI Content] Error:", error);
    return NextResponse.json({ error: "Failed to generate content" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Get count before deletion for reporting
    const contentCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(aiGeneratedContent);

    const historyCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(aiGenerationHistory);

    // Delete history first (foreign key constraint)
    await db.delete(aiGenerationHistory);

    // Delete all AI generated content
    await db.delete(aiGeneratedContent);

    const totalContent = contentCount[0]?.count ?? 0;
    const totalHistory = historyCount[0]?.count ?? 0;

    console.log(`[AI Content] Deleted ${totalContent} content entries and ${totalHistory} history entries`);

    return NextResponse.json({
      success: true,
      contentDeleted: totalContent,
      historyDeleted: totalHistory,
      message: `Deleted ${totalContent} cover letters and referral messages`,
    });
  } catch (error) {
    console.error("[AI Content API] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete AI generated content" },
      { status: 500 }
    );
  }
}
