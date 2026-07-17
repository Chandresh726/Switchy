import {
  getMatchPipelineProgress,
  getMatchSessionStatus,
} from "@/lib/ai/matcher/tracking";
import { db } from "@/lib/db";
import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/scraper/runtime/data-operation-gate";

import type { MatchWorkPayload } from "./contracts";
import { dispatchPendingAIWork } from "./dispatcher";
import {
  DrizzleAIWorkStore,
  enqueueCoalescedProfileMatchWork,
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
  void dispatchPendingAIWork();
  return queued;
}

export function queueProfileRematchWork(jobIds: number[]): {
  sessionId: string;
  status: "queued";
  total: number;
} {
  const queued = enqueueCoalescedProfileMatchWork(db, jobIds);
  void dispatchPendingAIWork();
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
  const [session, pipeline] = await Promise.all([
    getMatchSessionStatus(sessionId),
    getMatchPipelineProgress(sessionId),
  ]);
  return session ? { ...session, pipeline } : null;
}
