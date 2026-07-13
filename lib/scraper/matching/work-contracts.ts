import { z } from "zod";

import type {
  NewMatchSession,
  NewScrapeMatchOutboxItem,
} from "@/lib/db/schema";

export const DEFAULT_MATCH_WORK_MAX_ATTEMPTS = 3;

export const MatchWorkResultSchema = z
  .object({
    sessionId: z.string().min(1),
    total: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    duration: z.number().int().nonnegative(),
  })
  .refine((result) => result.succeeded + result.failed === result.total, {
    message: "Match result counters must equal the total.",
  });

export type MatchWorkResult = z.infer<typeof MatchWorkResultSchema>;

export interface CreateMatchWorkInput {
  id: string;
  scrapingLogId: number;
  companyId: number;
  jobIds: number[];
  now: Date;
  maxAttempts?: number;
}

export interface MatchWorkRecords {
  session: NewMatchSession;
  outbox: NewScrapeMatchOutboxItem;
}

export function createMatchWorkRecords(
  input: CreateMatchWorkInput
): MatchWorkRecords {
  return {
    session: {
      id: input.id,
      triggerSource: "auto_match",
      companyId: input.companyId,
      status: "queued",
      jobsTotal: input.jobIds.length,
      jobsCompleted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      errorCount: 0,
      startedAt: null,
    },
    outbox: {
      id: input.id,
      scrapingLogId: input.scrapingLogId,
      companyId: input.companyId,
      jobIdsJson: JSON.stringify(input.jobIds),
      status: "pending",
      maxAttempts: input.maxAttempts ?? DEFAULT_MATCH_WORK_MAX_ATTEMPTS,
      availableAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}
