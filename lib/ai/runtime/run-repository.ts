import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { isReasoningEffort } from "@/lib/ai/providers/types";
import type * as databaseSchema from "@/lib/db/schema";
import { aiRuns } from "@/lib/db/schema";

import type {
  AICapability,
  AIExecutionSubject,
  AIExecutionUsage,
  AIExecutionVersions,
  AIRunCacheStatus,
  AIRunQualityResult,
  ResolvedModelSnapshot,
  SafeAIMetadata,
} from "./types";

const AICapabilitySchema = z.enum([
  "job_analysis",
  "match_adjudication",
  "match_evaluation",
  "writing_cover_letter",
  "writing_referral",
  "writing_recruiter_follow_up",
  "resume_parse",
]);

const RuntimeMetadataSchema = z.object({
  backendKind: z.enum(["ai_sdk", "codex_cli", "opencode_cli"]).optional(),
  cliVersion: z.string().min(1).max(80).optional(),
  upstreamProvider: z.string().min(1).max(120).optional(),
  reasoningEffort: z.union([
    z.literal("provider_default"),
    z.string().refine(isReasoningEffort),
  ]).optional(),
  structuredGenerationStrategy: z.enum(["native", "portable_json"]).optional(),
  timeoutMode: z.enum(["hard_deadline", "completion_wait"]).optional(),
});

const CAPABILITY_METADATA_SCHEMAS: Record<
  AICapability,
  z.ZodType<SafeAIMetadata>
> = {
  job_analysis: RuntimeMetadataSchema.extend({
    batchSize: z.number().int().min(1).max(100).optional(),
    jobCount: z.number().int().min(1).max(10_000).optional(),
    fallbackUsed: z.boolean().optional(),
  }).strict(),
  match_adjudication: RuntimeMetadataSchema.extend({
    batchSize: z.number().int().min(1).max(100).optional(),
    jobCount: z.number().int().min(1).max(10_000).optional(),
    preset: z.enum(["economy", "balanced", "quality"]).optional(),
  }).strict(),
  match_evaluation: RuntimeMetadataSchema.extend({
    batchSize: z.number().int().min(1).max(100).optional(),
    jobCount: z.number().int().min(1).max(10_000).optional(),
  }).strict(),
  writing_cover_letter: RuntimeMetadataSchema.extend({
    streamed: z.boolean().optional(),
    modification: z.boolean().optional(),
  }).strict(),
  writing_referral: RuntimeMetadataSchema.extend({
    streamed: z.boolean().optional(),
    modification: z.boolean().optional(),
  }).strict(),
  writing_recruiter_follow_up: RuntimeMetadataSchema.extend({
    streamed: z.boolean().optional(),
    modification: z.boolean().optional(),
  }).strict(),
  resume_parse: RuntimeMetadataSchema.extend({
    fileType: z.enum(["pdf", "doc", "docx", "txt", "md"]).optional(),
    pageCount: z.number().int().min(1).max(10_000).optional(),
  }).strict(),
};

const InputFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const VersionIdentifierSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
const VersionsSchema = z.object({
  prompt: VersionIdentifierSchema,
  schema: VersionIdentifierSchema,
  policy: VersionIdentifierSchema,
}).strict();
const JOB_SUBJECT_SCHEMA = z.object({
  type: z.literal("job"),
  id: z.string().regex(/^\d+$/),
}).strict();
const JOB_BATCH_SUBJECT_SCHEMA = z.object({
  type: z.literal("job_batch"),
  id: z.string().max(2_000).regex(/^\d+(,\d+)*$/),
}).strict();
const SUBJECT_SCHEMAS: Record<AICapability, z.ZodType<AIExecutionSubject>> = {
  job_analysis: z.union([JOB_SUBJECT_SCHEMA, JOB_BATCH_SUBJECT_SCHEMA]),
  match_adjudication: z.union([JOB_SUBJECT_SCHEMA, JOB_BATCH_SUBJECT_SCHEMA]),
  match_evaluation: z.union([JOB_SUBJECT_SCHEMA, JOB_BATCH_SUBJECT_SCHEMA]),
  writing_cover_letter: JOB_SUBJECT_SCHEMA,
  writing_referral: JOB_SUBJECT_SCHEMA,
  writing_recruiter_follow_up: JOB_SUBJECT_SCHEMA,
  resume_parse: z.object({
    type: z.literal("resume"),
    id: z.string().regex(/^[a-f0-9]{24}$/),
  }).strict(),
};
const ProviderRecordIdSchema = z.union([
  z.string().uuid(),
  z.enum(["builtin:codex-cli", "builtin:opencode-cli"]),
]);
const ModelIdentifierSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9._:/@+-]+$/);

const WarningCodesSchema = z.array(z.string().min(1).max(120)).max(20);

type AIRunDatabase = BetterSQLite3Database<typeof databaseSchema>;

interface CreateAIRunInput {
  capability: AICapability;
  subject?: AIExecutionSubject;
  snapshot: ResolvedModelSnapshot;
  versions: AIExecutionVersions;
  inputFingerprint: string;
  cacheStatus: AIRunCacheStatus;
  metadata?: SafeAIMetadata;
}

interface CompleteAIRunSuccessInput {
  attempts: number;
  usage: AIExecutionUsage;
  durationMs: number;
  finishReason?: string;
  warningCodes: string[];
  qualityResult: AIRunQualityResult;
}

interface CompleteAIRunFailureInput {
  attempts: number;
  usage: AIExecutionUsage;
  durationMs: number;
  finishReason?: string;
  error: unknown;
  warningCodes?: string[];
  qualityResult?: AIRunQualityResult;
}

interface RecordResolutionFailureInput {
  capability: AICapability;
  inputFingerprint: string;
  error: unknown;
}

function serializeMetadata(
  capability: AICapability,
  metadata?: SafeAIMetadata
): string | null {
  if (!metadata) return null;
  const validated = CAPABILITY_METADATA_SCHEMAS[capability].parse(metadata);
  return JSON.stringify(validated);
}

function serializeWarningCodes(warningCodes: string[]): string | null {
  const validated = WarningCodesSchema.parse(warningCodes);
  return validated.length > 0 ? JSON.stringify(validated) : null;
}

export function createAIRunRepository(database: AIRunDatabase) {
  return {
    async create(input: CreateAIRunInput): Promise<string> {
      const id = randomUUID();
      const inputFingerprint = InputFingerprintSchema.parse(input.inputFingerprint);
      const versions = VersionsSchema.parse(input.versions);
      const subject = input.subject
        ? SUBJECT_SCHEMAS[input.capability].parse(input.subject)
        : undefined;
      const providerRecordId = ProviderRecordIdSchema.parse(
        input.snapshot.providerRecordId
      );
      const modelId = ModelIdentifierSchema.parse(input.snapshot.modelId);
      await database.insert(aiRuns).values({
        id,
        capability: input.capability,
        subjectType: subject?.type,
        subjectId: subject?.id,
        providerRecordId,
        provider: input.snapshot.provider,
        modelId,
        promptVersion: versions.prompt,
        schemaVersion: versions.schema,
        policyVersion: versions.policy,
        inputFingerprint,
        cacheStatus: input.cacheStatus,
        metadataJson: serializeMetadata(input.capability, input.metadata),
        status: "running",
        startedAt: new Date(),
        createdAt: new Date(),
      });
      return id;
    },

    async recordResolutionFailure(input: RecordResolutionFailureInput): Promise<string> {
      const id = randomUUID();
      const now = new Date();
      const sanitized = sanitizeAIError(input.error);
      await database.insert(aiRuns).values({
        id,
        capability: input.capability,
        providerRecordId: "unresolved",
        provider: "unresolved",
        modelId: "unresolved",
        promptVersion: "runtime-resolution-v1",
        schemaVersion: "runtime-resolution-v1",
        policyVersion: "runtime-resolution-v1",
        inputFingerprint: InputFingerprintSchema.parse(input.inputFingerprint),
        status: sanitized.code === "aborted" ? "cancelled" : "failed",
        attemptCount: 0,
        durationMs: 0,
        cacheStatus: "bypass",
        qualityResult: "not_checked",
        errorCode: sanitized.code,
        errorMessage: sanitized.message,
        startedAt: now,
        completedAt: now,
        createdAt: now,
      });
      return id;
    },

    async completeSuccess(id: string, input: CompleteAIRunSuccessInput): Promise<void> {
      await database
        .update(aiRuns)
        .set({
          status: "succeeded",
          attemptCount: input.attempts,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.totalTokens,
          durationMs: input.durationMs,
          finishReason: input.finishReason,
          warningsJson: serializeWarningCodes(input.warningCodes),
          qualityResult: input.qualityResult,
          errorCode: null,
          errorMessage: null,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, id));
    },

    async completeFailure(id: string, input: CompleteAIRunFailureInput): Promise<void> {
      const sanitized = sanitizeAIError(input.error);
      await database
        .update(aiRuns)
        .set({
          status: sanitized.code === "aborted" ? "cancelled" : "failed",
          attemptCount: input.attempts,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.totalTokens,
          durationMs: input.durationMs,
          finishReason: input.finishReason,
          warningsJson: serializeWarningCodes(input.warningCodes ?? []),
          qualityResult: input.qualityResult ?? "not_checked",
          errorCode: sanitized.code,
          errorMessage: sanitized.message,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, id));
    },

    async findById(id: string) {
      const rows = await database.select().from(aiRuns).where(eq(aiRuns.id, id)).limit(1);
      const row = rows[0];
      if (!row) return null;

      return {
        ...row,
        warnings: row.warningsJson
          ? WarningCodesSchema.parse(JSON.parse(row.warningsJson))
          : [],
        metadata: row.metadataJson
          ? CAPABILITY_METADATA_SCHEMAS[
              AICapabilitySchema.parse(row.capability)
            ].parse(JSON.parse(row.metadataJson))
          : {},
      };
    },
  };
}
