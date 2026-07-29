import { z } from "zod";

import { AIContentTypeSchema } from "@/lib/ai/contracts";
import {
  AI_CAPABILITY_GROUP_NAMES,
  type AICapabilityGroup,
} from "@/lib/ai/runtime/capability-groups";

export const aiUsageQuerySchema = z.object({
  days: z.enum(["7", "30", "all"]).default("7").transform((value) => (
    value === "all" ? value : Number(value) as 7 | 30
  )),
  group: z.enum(AI_CAPABILITY_GROUP_NAMES as [AICapabilityGroup, ...AICapabilityGroup[]]).optional(),
});

const aiRunAttemptSummarySchema = z.object({
  attemptNumber: z.number().int().positive(),
  status: z.string(),
  inputTokens: z.number().int().nonnegative().nullable(),
  inputNoCacheTokens: z.number().int().nonnegative().nullable().default(null),
  inputCacheReadTokens: z.number().int().nonnegative().nullable().default(null),
  inputCacheWriteTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable(),
  outputTextTokens: z.number().int().nonnegative().nullable().default(null),
  outputReasoningTokens: z.number().int().nonnegative().nullable().default(null),
  totalTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  finishReason: z.string().nullable(),
  providerRequestId: z.string().nullable().default(null),
  warningCodes: z.array(z.string()).default([]),
  errorCode: z.string().nullable(),
  retryDelayMs: z.number().int().nonnegative().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const aiRunSummarySchema = z.object({
  id: z.string(),
  capability: z.string(),
  provider: z.string(),
  modelId: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  inputNoCacheTokens: z.number().int().nonnegative().nullable().default(null),
  inputCacheReadTokens: z.number().int().nonnegative().nullable().default(null),
  inputCacheWriteTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable(),
  outputTextTokens: z.number().int().nonnegative().nullable().default(null),
  outputReasoningTokens: z.number().int().nonnegative().nullable().default(null),
  totalTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  finishReason: z.string().nullable(),
  providerRequestId: z.string().nullable().default(null),
  providerConfigFingerprint: z.string().nullable().default(null),
  cacheStatus: z.string(),
  qualityResult: z.string(),
  warningCodes: z.array(z.string()).default([]),
  errorCode: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  attemptHistory: z.array(aiRunAttemptSummarySchema).default([]),
});

const aiGenerationEventSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["selected", "copied", "discarded"]),
  source: z.enum(["generated", "initial_load", "navigation", "copy", "discard"]),
  createdAt: z.string(),
});

const aiHistoryVariantSchema = z.object({
  id: z.number().int().positive(),
  variant: z.string(),
  userPrompt: z.string().nullable(),
  parentVariantId: z.number().int().positive().nullable(),
  aiRunId: z.string().nullable(),
  aiRun: aiRunSummarySchema.nullable().optional(),
  source: z.enum(["generated", "manual_edit"]),
  selectedAt: z.string().nullable(),
  copiedAt: z.string().nullable(),
  discardedAt: z.string().nullable(),
  editDistance: z.number().nullable(),
  editDistanceRatio: z.number().nullable(),
  createdAt: z.string().nullable(),
  events: z.array(aiGenerationEventSchema).default([]),
});

const generatedContentSchema = z.object({
  id: z.number().int().positive(),
  jobId: z.number().int().positive(),
  type: AIContentTypeSchema,
  content: z.string(),
  currentVariantId: z.number().int().positive().nullable().default(null),
  settingsSnapshot: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(aiHistoryVariantSchema),
  jobTitle: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  companyLogoUrl: z.string().nullable().optional(),
});

export const aiHistoryResponseSchema = z.object({ contents: z.array(generatedContentSchema) });
export const aiContentEnvelopeSchema = z.object({ exists: z.boolean(), content: generatedContentSchema.nullable() });
export const aiContentWriteResponseSchema = z.object({ content: generatedContentSchema, runId: z.string().nullable().optional() });
export const aiStreamDeltaSchema = z.object({ text: z.string() });
export const aiStreamCompleteSchema = z.object({
  content: generatedContentSchema,
  runId: z.string().nullable(),
});
export const aiStreamErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
});
export const aiUsageResponseSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal("all")]),
  periodStart: z.string(),
  periodEnd: z.string(),
  executions: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  abandoned: z.number().int().nonnegative().default(0),
  successRate: z.number().nonnegative(),
  terminalExecutions: z.number().int().nonnegative().default(0),
  tokenTrackedExecutions: z.number().int().nonnegative().default(0),
  tokenCoveragePercent: z.number().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative(),
  inputNoCacheTokens: z.number().int().nonnegative().default(0),
  inputCacheReadTokens: z.number().int().nonnegative().default(0),
  inputCacheWriteTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  outputTextTokens: z.number().int().nonnegative().default(0),
  outputReasoningTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative(),
  cacheHits: z.number().int().nonnegative().default(0),
  fullMatchCacheReuses: z.number().int().nonnegative().optional(),
  capabilities: z.array(z.object({
    capability: z.string(),
    executions: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    abandoned: z.number().int().nonnegative().default(0),
    cacheHits: z.number().int().nonnegative().default(0),
    tokenTrackedExecutions: z.number().int().nonnegative().default(0),
    totalTokens: z.number().int().nonnegative(),
    averageLatencyMs: z.number().nonnegative(),
  })),
  providers: z.array(z.object({
    provider: z.string(),
    modelId: z.string(),
    executions: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    abandoned: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })).default([]),
  failures: z.array(z.object({ code: z.string(), count: z.number().int().nonnegative() })),
});

export type GeneratedContent = z.infer<typeof generatedContentSchema>;
export type AIHistoryResponse = z.infer<typeof aiHistoryResponseSchema>;
export type AIUsageResponse = z.infer<typeof aiUsageResponseSchema>;
