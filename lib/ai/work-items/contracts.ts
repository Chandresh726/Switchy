import { z } from "zod";

import type { NewAIWorkItem, NewMatchSession } from "@/lib/db/schema";

export const AIWorkTypeSchema = z.enum(["match_jobs"]);
export type AIWorkType = z.infer<typeof AIWorkTypeSchema>;

export const MatchWorkPayloadSchema = z.object({
  jobIds: z.array(z.number().int().positive()).min(1).max(100_000)
    .transform((values) => Array.from(new Set(values))),
  triggerSource: z.enum(["manual", "auto_match", "company_refresh", "match_unmatched"]),
  companyId: z.number().int().positive().nullable().optional(),
  scrapingLogId: z.number().int().positive().nullable().optional(),
  legacyOutboxId: z.string().min(1).nullable().optional(),
});
export type MatchWorkPayload = z.infer<typeof MatchWorkPayloadSchema>;

export const MatchWorkResultSchema = z.object({
  sessionId: z.string().min(1),
  total: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  duration: z.number().int().nonnegative(),
}).refine((result) => result.succeeded + result.failed === result.total, {
  message: "Match result counters must equal the total.",
});
export type MatchWorkResult = z.infer<typeof MatchWorkResultSchema>;

export interface CreateAIWorkRecordsInput {
  id: string;
  jobIds: number[];
  triggerSource: MatchWorkPayload["triggerSource"];
  companyId?: number | null;
  scrapingLogId?: number | null;
  legacyOutboxId?: string | null;
  now: Date;
  maxAttempts?: number;
}

export function createAIWorkRecords(input: CreateAIWorkRecordsInput): {
  session: NewMatchSession;
  workItem: NewAIWorkItem;
} {
  const payload = MatchWorkPayloadSchema.parse({
    jobIds: input.jobIds,
    triggerSource: input.triggerSource,
    companyId: input.companyId ?? null,
    scrapingLogId: input.scrapingLogId ?? null,
    legacyOutboxId: input.legacyOutboxId ?? null,
  });
  return {
    session: {
      id: input.id,
      triggerSource: payload.triggerSource,
      companyId: payload.companyId ?? null,
      status: "queued",
      jobsTotal: payload.jobIds.length,
      jobsCompleted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      errorCount: 0,
      startedAt: null,
    },
    workItem: {
      id: input.id,
      workType: "match_jobs",
      matchSessionId: input.id,
      scrapingLogId: payload.scrapingLogId ?? null,
      companyId: payload.companyId ?? null,
      payloadJson: JSON.stringify(payload),
      status: "queued",
      maxAttempts: input.maxAttempts ?? 3,
      availableAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

export function parseMatchWorkPayload(payloadJson: string): MatchWorkPayload {
  return MatchWorkPayloadSchema.parse(JSON.parse(payloadJson));
}

export function parseMatchWorkResult(resultJson: string | null): MatchWorkResult {
  return MatchWorkResultSchema.parse(resultJson === null ? null : JSON.parse(resultJson));
}
