import { z } from "zod";

import { AIContentTypeSchema } from "@/lib/ai/contracts";

export const aiUsageQuerySchema = z.object({
  days: z.enum(["7", "30"]).default("7").transform((value) => Number(value) as 7 | 30),
});

export const aiRunSummarySchema = z.object({
  id: z.string(),
  capability: z.string(),
  provider: z.string(),
  modelId: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  finishReason: z.string().nullable(),
  cacheStatus: z.string(),
  qualityResult: z.string(),
  errorCode: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
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
});

const generatedContentSchema = z.object({
  id: z.number().int().positive(),
  jobId: z.number().int().positive(),
  type: AIContentTypeSchema,
  content: z.string(),
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
  days: z.union([z.literal(7), z.literal(30)]),
  periodStart: z.string(),
  periodEnd: z.string(),
  executions: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  successRate: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative(),
  fullMatchCacheReuses: z.number().int().nonnegative(),
  capabilities: z.array(z.object({
    capability: z.string(),
    executions: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    averageLatencyMs: z.number().nonnegative(),
  })),
  failures: z.array(z.object({ code: z.string(), count: z.number().int().nonnegative() })),
});

export type GeneratedContent = z.infer<typeof generatedContentSchema>;
export type AIHistoryResponse = z.infer<typeof aiHistoryResponseSchema>;
export type AIUsageResponse = z.infer<typeof aiUsageResponseSchema>;
