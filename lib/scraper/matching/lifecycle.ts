import { db } from "@/lib/db";
import {
  DrizzleAIWorkStore,
  type StopMatchSessionResult,
} from "@/lib/ai/work-items/repository";
import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/scraper/runtime/data-operation-gate";

export async function stopMatchSession(
  sessionId: string,
  database: typeof db = db,
  dataOperationGate: LocalDataOperationGate = getLocalDataOperationGate()
): Promise<StopMatchSessionResult> {
  dataOperationGate.cancelMatches({ sessionId });
  return new DrizzleAIWorkStore(database).stopSession(sessionId);
}
