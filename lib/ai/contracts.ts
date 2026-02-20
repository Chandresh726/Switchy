import { z } from "zod";

export const AI_CONTENT_TYPE_VALUES = ["cover_letter", "referral"] as const;
export const AIContentTypeSchema = z.enum(AI_CONTENT_TYPE_VALUES);

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
});

export const AIContentQuerySchema = z.object({
  jobId: z.coerce.number().int().positive(),
  type: AIContentTypeSchema,
});

export const AIContentPostBodySchema = z.object({
  jobId: z.coerce.number().int().positive(),
  type: AIContentTypeSchema,
  userPrompt: z.string().trim().max(4_000).nullable().optional(),
});

export const AIContentPatchBodySchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  userPrompt: z.string().trim().max(4_000).nullable().optional(),
});

export const ProviderRouteParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const ReasoningEffortSchema = z.enum(["low", "medium", "high"]);

export const AISettingsUpdateSchema = z.object({
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
  cover_letter_tone: z.enum(["professional", "formal", "casual", "flexible"]).optional(),
  cover_letter_length: z.enum(["short", "medium", "long"]).optional(),
  cover_letter_focus: z.union([
    z.enum(["skills", "experience", "cultural_fit", "all"]),
    z.array(z.enum(["skills", "experience", "cultural_fit"])),
    z.string().trim().min(1),
  ]).optional(),
});

export type MatchRouteBody = z.infer<typeof MatchRouteBodySchema>;
export type MatchUnmatchedQuery = z.infer<typeof MatchUnmatchedQuerySchema>;
export type AIContentPostBody = z.infer<typeof AIContentPostBodySchema>;
export type AIContentPatchBody = z.infer<typeof AIContentPatchBodySchema>;
export type AISettingsUpdate = z.infer<typeof AISettingsUpdateSchema>;
