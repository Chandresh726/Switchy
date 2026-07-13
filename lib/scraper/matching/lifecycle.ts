import { db } from "@/lib/db";
import {
  DrizzleMatchWorkStore,
  type StopMatchSessionResult,
} from "@/lib/scraper/matching/match-work-store";
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
  return new DrizzleMatchWorkStore(database).stopSession(sessionId);
}
