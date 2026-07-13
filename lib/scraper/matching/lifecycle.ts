import { db } from "@/lib/db";
import {
  DrizzleMatchWorkStore,
  type StopMatchSessionResult,
} from "@/lib/scraper/matching/match-work-store";

export async function stopMatchSession(
  sessionId: string,
  database: typeof db = db
): Promise<StopMatchSessionResult> {
  return new DrizzleMatchWorkStore(database).stopSession(sessionId);
}
