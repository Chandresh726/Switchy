import { z } from "zod";

import { isReasoningEffort } from "@/lib/ai/providers/types";

const AI_CONTENT_TYPE_VALUES = ["cover_letter", "referral", "recruiter_follow_up"] as const;
export const AIContentTypeSchema = z.enum(AI_CONTENT_TYPE_VALUES);
export type AIContentType = z.infer<typeof AIContentTypeSchema>;

export const MatchRouteBodySchema = z.union([
  z.object({
    jobId: z.coerce.number().int().positive(),
  }),
  z.object({
    jobIds: z.array(z.coerce.number().int().positive()).min(1),
  }),
]);

export const MatchUnmatchedQuerySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  days: z.coerce.number().int().min(1).max(365).default(5),
});

export const MatchUnmatchedBodySchema = z.object({
  days: z.coerce.number().int().min(1).max(365),
});

export const AIContentQuerySchema = z.object({
  jobId: z.coerce.number().int().positive(),
  type: AIContentTypeSchema,
});

export const AIContentPostBodySchema = z.object({
  jobId: z.coerce.number().int().positive(),
  type: AIContentTypeSchema,
  userPrompt: z.string().trim().max(4_000).nullable().optional(),
  parentVariantId: z.coerce.number().int().positive().nullable().optional(),
});

export const AIContentPatchBodySchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  userPrompt: z.string().trim().max(4_000).nullable().optional(),
  parentVariantId: z.coerce.number().int().positive().nullable().optional(),
});

export const AIContentVariantSignalSchema = z.object({
  action: z.enum(["selected", "copied", "discarded"]),
  source: z.enum(["initial_load", "navigation", "copy", "discard"]).optional(),
});

export const ProviderRouteParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const ReasoningEffortSchema = z.union([
  z.literal(""),
  z.string().refine(isReasoningEffort, "Invalid provider reasoning value"),
]);

export const AISettingsUpdateSchema = z.object({
  job_analysis_model: z.string().trim().min(1).optional(),
  job_analysis_provider_id: z.string().trim().optional(),
  job_analysis_reasoning_effort: ReasoningEffortSchema.optional(),
  matcher_model: z.string().trim().min(1).optional(),
  matcher_provider_id: z.string().trim().optional(),
  matcher_reasoning_effort: ReasoningEffortSchema.optional(),
  resume_parser_model: z.string().trim().min(1).optional(),
  resume_parser_provider_id: z.string().trim().optional(),
  resume_parser_reasoning_effort: ReasoningEffortSchema.optional(),
  ai_writing_model: z.string().trim().min(1).optional(),
  ai_writing_provider_id: z.string().trim().optional(),
  ai_writing_reasoning_effort: ReasoningEffortSchema.optional(),
  referral_tone: z.enum(["professional", "casual", "friendly", "flexible"]).optional(),
  referral_length: z.enum(["short", "medium", "long"]).optional(),
  follow_up_tone: z.enum(["professional", "casual", "friendly", "flexible"]).optional(),
  follow_up_length: z.enum(["short", "medium", "long"]).optional(),
  cover_letter_tone: z.enum(["professional", "formal", "casual", "flexible"]).optional(),
  cover_letter_length: z.enum(["short", "medium", "long"]).optional(),
  cover_letter_focus: z.union([
    z.enum(["skills", "experience", "cultural_fit", "all"]),
    z.array(z.enum(["skills", "experience", "cultural_fit"])),
    z.string().trim().min(1),
  ]).optional(),
  codex_cli_executable: z.string().trim().optional(),
  opencode_cli_executable: z.string().trim().optional(),
});
