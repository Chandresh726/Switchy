import { eq } from "drizzle-orm";

import { getMatchSessionStatus } from "@/lib/ai/matcher/tracking";
import { db } from "@/lib/db";
import { matchSessions } from "@/lib/db/schema";
import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/scraper/runtime/data-operation-gate";

import type { MatchWorkPayload } from "./contracts";
import { dispatchPendingAIWork } from "./dispatcher";
import {
  DrizzleAIWorkStore,
  enqueueMatchWork,
  insertCompletedEmptyMatchSession,
  type StopMatchSessionResult,
} from "./repository";

export interface QueueMatchInput {
  jobIds: number[];
  triggerSource: MatchWorkPayload["triggerSource"];
  companyId?: number | null;
  scrapingLogId?: number | null;
}

export function queueMatchWork(input: QueueMatchInput): {
  sessionId: string;
  status: "queued";
  total: number;
} {
  const queued = enqueueMatchWork(db, input);
  dispatchPendingAIWork();
  return queued;
}

export function completeEmptyMatchSession(
  input: Omit<QueueMatchInput, "jobIds">
): { sessionId: string; status: "completed"; total: 0 } {
  return insertCompletedEmptyMatchSession(db, input);
}

export async function stopAIWorkSession(
  sessionId: string,
  database: typeof db = db,
  dataOperationGate: LocalDataOperationGate = getLocalDataOperationGate()
): Promise<StopMatchSessionResult> {
  dataOperationGate.cancelMatches({ sessionId });
  return new DrizzleAIWorkStore(database).stopSession(sessionId);
}

export async function getAIWorkSession(sessionId: string) {
  return getMatchSessionStatus(sessionId);
}

export async function hasMatchSession(sessionId: string): Promise<boolean> {
  const rows = await db.select({ id: matchSessions.id }).from(matchSessions)
    .where(eq(matchSessions.id, sessionId)).limit(1);
  return rows.length === 1;
}
