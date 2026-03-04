import { generateText } from "ai";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { APIValidationError } from "@/lib/api/ai-error-handler";
import type { AIContentType } from "@/lib/ai/contracts";
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
import {
  buildRecruiterFollowUpPromptFromProfileData,
  RECRUITER_FOLLOW_UP_SYSTEM_PROMPT,
  type RecruiterFollowUpSettings,
} from "../prompts/recruiter-follow-up";
import { fetchCandidateProfile, fetchJobWithCompany } from "./utils";
import type { ContentResponse } from "./types";

const MAX_USER_PROMPT_CHARS = 4_000;
const MAX_HISTORY_VARIANTS = 8;
const MAX_JOB_DESCRIPTION_CHARS = 2_000;
const LOW_SIGNAL_OUTPUTS = new Set(["test", "testing", "ntg", "none", "n/a", "na", "placeholder"]);
const inFlightGenerationRequests = new Map<string, Promise<ContentResponse>>();

interface ContentHistoryItem {
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
  const priorRequests = history
    .map((entry) => entry.userPrompt?.trim() || "")
    .filter((entry) => Boolean(entry) && entry !== "Manual edit");

  const instructions = [
    "Apply this edit request to the current draft.",
    `Current request: ${truncate(currentRequest, MAX_USER_PROMPT_CHARS)}`,
  ];

  if (priorRequests.length > 0) {
    const recentRequests = priorRequests.slice(-4);
    instructions.push("Previous requests to keep in mind:");
    for (const request of recentRequests) {
      instructions.push(`- ${truncate(request, MAX_USER_PROMPT_CHARS)}`);
    }
  }

  return instructions.join("\n");
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

function getRecruiterFollowUpSettings(
  settingsMap: Map<string, string>
): RecruiterFollowUpSettings {
  return {
    tone: settingsMap.get("follow_up_tone") || "professional",
    length: settingsMap.get("follow_up_length") || "medium",
  };
}

function isLowQualityOutput(type: AIContentType, text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;

  const punctuationStripped = normalized.replace(/[.!?,;:]/g, "");
  if (LOW_SIGNAL_OUTPUTS.has(punctuationStripped)) return true;
  if (!/[a-z]{3}/.test(normalized)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  const minWordsByType: Record<AIContentType, number> = {
    cover_letter: 35,
    recruiter_follow_up: 10,
    referral: 10,
  };

  return words.length < minWordsByType[type];
}

function isInvalidRecruiterPerspective(text: string, profileName?: string | null): boolean {
  const normalized = text.toLowerCase();

  if (/\b(the candidate|this candidate)\b/.test(normalized)) return true;
  if (/\b(he|she)\b/.test(normalized)) return true;
  if (/\bthey have applied\b/.test(normalized)) return true;
  if (/\b[a-z]+\s+has\s+applied\b/.test(normalized)) return true;

  const safeName = (profileName || "").trim().toLowerCase();
  if (safeName.length > 0) {
    const namedPattern = new RegExp(`${escapeRegExp(safeName)}\\s+has\\s+applied`);
    if (namedPattern.test(normalized)) return true;
  }

  // First-person pronouns should exist in follow-up output.
  if (!/\b(i|me|my)\b/.test(normalized)) return true;

  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function generateValidatedText(input: {
  profileName?: string | null;
  prompt: string;
  systemPrompt: string;
  type: AIContentType;
  aiContext: Awaited<ReturnType<typeof resolveAIContextForFeature>>;
}): Promise<string> {
  const firstAttempt = await generateText({
    model: input.aiContext.model,
    system: input.systemPrompt,
    prompt: input.prompt,
    ...input.aiContext.providerOptions,
  });

  const firstAttemptLowQuality = isLowQualityOutput(input.type, firstAttempt.text);
  const firstAttemptWrongPerspective =
    input.type === "recruiter_follow_up" &&
    isInvalidRecruiterPerspective(firstAttempt.text, input.profileName);

  if (!firstAttemptLowQuality && !firstAttemptWrongPerspective) {
    return firstAttempt.text;
  }

  const retryPrompt = `${input.prompt}

IMPORTANT OUTPUT QUALITY REQUIREMENTS:
- The previous response was too low quality or too short.
- Write a complete, high-quality final version now.
- Do not return placeholders like "test" or filler text.
- Follow all formatting instructions exactly.`;

  const perspectiveRetryPrompt =
    input.type === "recruiter_follow_up"
      ? `${retryPrompt}
- CRITICAL: Use first-person voice only ("I", "my", "me"). Do NOT use third-person phrasing like "the candidate" or "{name} has applied".`
      : retryPrompt;

  const retryAttempt = await generateText({
    model: input.aiContext.model,
    system: input.systemPrompt,
    prompt: perspectiveRetryPrompt,
    ...input.aiContext.providerOptions,
  });

  const retryLowQuality = isLowQualityOutput(input.type, retryAttempt.text);
  const retryWrongPerspective =
    input.type === "recruiter_follow_up" &&
    isInvalidRecruiterPerspective(retryAttempt.text, input.profileName);

  if (retryLowQuality || retryWrongPerspective) {
    throw new Error("Generated content quality was too low. Please try again.");
  }

  return retryAttempt.text;
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
    type: content.type as AIContentType,
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
  if (type === "recruiter_follow_up") {
    const jobData = await fetchJobWithCompany(jobId);
    if (!jobData || jobData.status !== "applied") {
      return null;
    }
  }

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

  const requestKey = `${input.jobId}:${input.type}:${normalizedUserPrompt ?? "__initial__"}`;
  const pendingRequest = inFlightGenerationRequests.get(requestKey);
  if (pendingRequest) {
    return pendingRequest;
  }

  const generationPromise = (async () => {
    const [jobData, profileData, settingsMap] = await Promise.all([
      fetchJobWithCompany(input.jobId),
      fetchCandidateProfile(),
      getSettingsMap(),
    ]);

    if (!jobData) {
      throw new Error("Job not found");
    }

    if (input.type === "recruiter_follow_up" && jobData.status !== "applied") {
      throw new APIValidationError(
        "Recruiter follow-up is only available for applied jobs.",
        "invalid_request",
        400
      );
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
    } else if (input.type === "referral") {
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
    } else {
      const followUpSettings = getRecruiterFollowUpSettings(settingsMap);
      settingsSnapshot = JSON.stringify(followUpSettings);
      systemPrompt = RECRUITER_FOLLOW_UP_SYSTEM_PROMPT.replace("{tone}", followUpSettings.tone);
      prompt = buildRecruiterFollowUpPromptFromProfileData(
        jobData.title,
        jobData.companyName,
        profileData,
        followUpSettings,
        jobData.url,
        jobData.externalId
      );
    }

    if (normalizedUserPrompt) {
      const context = buildConversationContext(conversationHistory, normalizedUserPrompt);
      prompt += `\n\nModification Request:\n${context}`;
    }

    const generatedText = await generateValidatedText({
      prompt,
      profileName: profileData.name,
      systemPrompt,
      type: input.type,
      aiContext,
    });
    const text = generatedText.trim();
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
  })();

  inFlightGenerationRequests.set(requestKey, generationPromise);
  try {
    return await generationPromise;
  } finally {
    if (inFlightGenerationRequests.get(requestKey) === generationPromise) {
      inFlightGenerationRequests.delete(requestKey);
    }
  }
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
    message: `Deleted ${totalContent} cover letters, referral messages, and recruiter follow-ups`,
  };
}
