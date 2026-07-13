import { db } from "@/lib/db";
import { LocalDataMaintenanceService } from "@/lib/scraper/maintenance";
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

export async function deleteAllJobsAndTerminateMatches(
  database: typeof db = db
): Promise<void> {
  await new LocalDataMaintenanceService(database).deleteAllJobs();
}

export async function deleteCompanyJobsAndTerminateWork(
  companyIds: number[],
  database: typeof db = db
): Promise<number> {
  return new LocalDataMaintenanceService(database).deleteCompanyJobs(companyIds);
}
