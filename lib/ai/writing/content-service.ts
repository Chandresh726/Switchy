import { generateText } from "ai";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { resolveAIContextForFeature } from "@/lib/ai/runtime-context";
import { db } from "@/lib/db";
import { aiGeneratedContent, aiGenerationHistory, settings } from "@/lib/db/schema";

import {
  buildCoverLetterPromptFromProfileData,
  COVER_LETTER_SYSTEM_PROMPT,
  type CoverLetterSettings,
} from "../prompts/cover-letter";
import {
  buildReferralPromptFromProfileData,
  REFERRAL_SYSTEM_PROMPT,
  type ReferralSettings,
} from "../prompts/referral";
import { fetchCandidateProfile, fetchJobWithCompany } from "./utils";
import type { ContentResponse } from "./types";

export type AIContentType = "cover_letter" | "referral";

const MAX_USER_PROMPT_CHARS = 4_000;
const MAX_HISTORY_VARIANTS = 8;
const MAX_HISTORY_VARIANT_CHARS = 2_500;
const MAX_JOB_DESCRIPTION_CHARS = 2_000;

interface ContentHistoryItem {
  variant: string;
  userPrompt: string | null;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return new Date().toISOString();
  return date.toISOString();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function buildConversationContext(
  history: ContentHistoryItem[],
  currentRequest: string
): string {
  if (history.length === 0) {
    return currentRequest;
  }

  let context = "=== CONVERSATION HISTORY ===\n\n";

  history.forEach((entry, index) => {
    if (!entry.userPrompt || entry.userPrompt === "Manual edit") {
      return;
    }

    const turn = index + 1;
    context += `Turn ${turn}:\n`;
    context += `User Request: ${truncate(entry.userPrompt, MAX_USER_PROMPT_CHARS)}\n`;
    context += `Your Response:\n${truncate(entry.variant, MAX_HISTORY_VARIANT_CHARS)}\n\n`;
  });

  context += "=== CURRENT REQUEST ===\n";
  context += `${truncate(currentRequest, MAX_USER_PROMPT_CHARS)}\n\n`;
  context += "=== INSTRUCTIONS ===\n";
  context += "Based on the conversation history above and the current request, generate a new version. ";
  context += "Consider what has already been done and apply the new changes. ";
  context += "Maintain context from previous turns while making the requested modifications.\n";

  return context;
}

async function getSettingsMap(): Promise<Map<string, string>> {
  const settingsRecords = await db.select().from(settings);
  const map = new Map<string, string>();
  for (const item of settingsRecords) {
    if (item.value !== null) {
      map.set(item.key, item.value);
    }
  }
  return map;
}

function getCoverLetterSettings(settingsMap: Map<string, string>): CoverLetterSettings {
  const focusRaw = settingsMap.get("cover_letter_focus") || "[\"skills\",\"experience\",\"cultural_fit\"]";
  let focus: string | string[];
  try {
    const parsed = JSON.parse(focusRaw);
    focus = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    focus = ["skills", "experience", "cultural_fit"];
  }

  return {
    tone: settingsMap.get("cover_letter_tone") || "professional",
    length: settingsMap.get("cover_letter_length") || "medium",
    focus,
  };
}

function getReferralSettings(settingsMap: Map<string, string>): ReferralSettings {
  return {
    tone: settingsMap.get("referral_tone") || "professional",
    length: settingsMap.get("referral_length") || "medium",
  };
}

async function getLatestContentRecord(jobId: number, type: AIContentType) {
  const results = await db
    .select()
    .from(aiGeneratedContent)
    .where(and(eq(aiGeneratedContent.jobId, jobId), eq(aiGeneratedContent.type, type)))
    .orderBy(desc(aiGeneratedContent.updatedAt))
    .limit(1);

  return results[0] ?? null;
}

async function getHistory(contentId: number) {
  return db
    .select()
    .from(aiGenerationHistory)
    .where(eq(aiGenerationHistory.contentId, contentId))
    .orderBy(asc(aiGenerationHistory.createdAt));
}

function toContentResponse(
  content: typeof aiGeneratedContent.$inferSelect,
  history: Array<typeof aiGenerationHistory.$inferSelect>
): ContentResponse {
  return {
    id: content.id,
    jobId: content.jobId,
    type: content.type,
    content: content.content,
    settingsSnapshot: content.settingsSnapshot,
    createdAt: formatDate(content.createdAt),
    updatedAt: formatDate(content.updatedAt),
    history: history.map((item) => ({
      id: item.id,
      variant: item.variant,
      userPrompt: item.userPrompt,
      createdAt: formatDate(item.createdAt),
    })),
  };
}

export async function getContentByJobAndType(
  jobId: number,
  type: AIContentType
): Promise<ContentResponse | null> {
  const content = await getLatestContentRecord(jobId, type);
  if (!content) {
    return null;
  }

  const history = await getHistory(content.id);
  return toContentResponse(content, history);
}

export async function generateContent(input: {
  jobId: number;
  type: AIContentType;
  userPrompt?: string | null;
}): Promise<ContentResponse> {
  const normalizedUserPrompt = input.userPrompt?.trim()
    ? truncate(input.userPrompt.trim(), MAX_USER_PROMPT_CHARS)
    : null;

  const [jobData, profileData, settingsMap] = await Promise.all([
    fetchJobWithCompany(input.jobId),
    fetchCandidateProfile(),
    getSettingsMap(),
  ]);

  if (!jobData) {
    throw new Error("Job not found");
  }

  if (!profileData) {
    throw new Error("Profile not found. Please set up your profile first.");
  }

  const aiContext = await resolveAIContextForFeature("writing", {
    providerId: settingsMap.get("ai_writing_provider_id") || undefined,
    modelId: settingsMap.get("ai_writing_model") || undefined,
    reasoningEffort: settingsMap.get("ai_writing_reasoning_effort") || undefined,
  });

  let systemPrompt: string;
  let prompt: string;
  let settingsSnapshot: string;
  let conversationHistory: ContentHistoryItem[] = [];

  if (normalizedUserPrompt) {
    const existing = await getLatestContentRecord(input.jobId, input.type);
    if (existing) {
      const history = await getHistory(existing.id);
      conversationHistory = history
        .slice(-MAX_HISTORY_VARIANTS)
        .map((item) => ({
          variant: truncate(item.variant, MAX_HISTORY_VARIANT_CHARS),
          userPrompt: item.userPrompt ? truncate(item.userPrompt, MAX_USER_PROMPT_CHARS) : null,
        }));
    }
  }

  if (input.type === "cover_letter") {
    const coverLetterSettings = getCoverLetterSettings(settingsMap);
    settingsSnapshot = JSON.stringify(coverLetterSettings);
    systemPrompt = COVER_LETTER_SYSTEM_PROMPT.replace("{tone}", coverLetterSettings.tone);
    prompt = buildCoverLetterPromptFromProfileData(
      jobData.title,
      jobData.companyName,
      truncate(jobData.description || "", MAX_JOB_DESCRIPTION_CHARS),
      profileData,
      coverLetterSettings,
      jobData.url,
      jobData.externalId
    );
  } else {
    const referralSettings = getReferralSettings(settingsMap);
    settingsSnapshot = JSON.stringify(referralSettings);
    systemPrompt = REFERRAL_SYSTEM_PROMPT.replace("{tone}", referralSettings.tone);
    prompt = buildReferralPromptFromProfileData(
      jobData.title,
      jobData.companyName,
      profileData,
      referralSettings,
      jobData.url,
      jobData.externalId
    );
  }

  if (normalizedUserPrompt) {
    const context = buildConversationContext(conversationHistory, normalizedUserPrompt);
    prompt += `\n\n## Modification Request\n${context}\n\nPlease provide the updated content based on the above request and conversation history.`;
  }

  const generation = await generateText({
    model: aiContext.model,
    system: systemPrompt,
    prompt,
    ...aiContext.providerOptions,
  });

  const text = generation.text;
  const existing = await getLatestContentRecord(input.jobId, input.type);
  let contentId: number;
  let savedContent: typeof aiGeneratedContent.$inferSelect | null = null;

  if (existing) {
    await db
      .update(aiGeneratedContent)
      .set({
        content: text,
        settingsSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(aiGeneratedContent.id, existing.id));
    contentId = existing.id;
    savedContent = { ...existing, content: text, settingsSnapshot, updatedAt: new Date() };
  } else {
    const insertResult = await db
      .insert(aiGeneratedContent)
      .values({
        jobId: input.jobId,
        type: input.type,
        content: text,
        settingsSnapshot,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    contentId = insertResult.lastInsertRowid as number;

    const inserted = await db
      .select()
      .from(aiGeneratedContent)
      .where(eq(aiGeneratedContent.id, contentId))
      .limit(1);
    savedContent = inserted[0] ?? null;
  }

  await db.insert(aiGenerationHistory).values({
    contentId,
    variant: text,
    userPrompt: normalizedUserPrompt,
    parentVariantId: null,
    createdAt: new Date(),
  });

  const history = await getHistory(contentId);

  if (!savedContent) {
    throw new Error("Failed to persist generated content");
  }

  return toContentResponse(savedContent, history);
}

export async function clearAllGeneratedContent(): Promise<{
  success: boolean;
  contentDeleted: number;
  historyDeleted: number;
  message: string;
}> {
  const contentCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiGeneratedContent);

  const historyCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiGenerationHistory);

  await db.delete(aiGenerationHistory);
  await db.delete(aiGeneratedContent);

  const totalContent = contentCount[0]?.count ?? 0;
  const totalHistory = historyCount[0]?.count ?? 0;

  return {
    success: true,
    contentDeleted: totalContent,
    historyDeleted: totalHistory,
    message: `Deleted ${totalContent} cover letters and referral messages`,
  };
}
