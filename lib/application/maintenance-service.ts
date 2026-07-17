import { ConflictError } from "@/lib/api";
import { deleteAllPeople } from "@/lib/people/sync";
import { getScrapeHistoryStore } from "@/lib/scraper/history";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

export async function clearJobs() {
  const deletedCount = await getLocalDataMaintenanceService().deleteAllJobs();
  return { success: true, deletedCount };
}

export async function clearPeople() {
  return deleteAllPeople();
}

export async function clearMatchHistory() {
  const deletedCount = await getLocalDataMaintenanceService().deleteMatchHistory();
  return { success: true, deletedCount };
}

export async function clearScrapeHistory() {
  const deletion = getScrapeHistoryStore().delete();
  if (deletion.active) {
    throw new ConflictError(
      "Stop the active scrape before deleting its history",
      "scrape_session_active"
    );
  }
  return { success: true, deleted: deletion.deleted };
}

export async function clearMatchData() {
  const jobsCleared = await getLocalDataMaintenanceService().deleteMatchData();
  return { success: true as const, jobsCleared, message: `Cleared match data from ${jobsCleared} jobs` };
}
