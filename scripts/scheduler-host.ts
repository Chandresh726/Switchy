/**
 * Manage the macOS LaunchAgent host for the Switchy scheduler.
 *
 * Usage:
 *   tsx scripts/scheduler-host.ts install|uninstall|status|sync
 *
 * The frontend only flips `scheduler_enabled` / `scheduler_cron` /
 * `scraper_keep_device_awake` settings. This script (and the automatic sync in
 * the settings service) owns OS-level persistence so scraping continues even
 * when no browser tab is open.
 */
import { db } from "@/lib/db";
import {
  SCHEDULER_SERVER_AGENT_LABEL,
  SCHEDULER_SERVER_PORT,
  SCHEDULER_TICK_AGENT_LABEL,
  SCHEDULER_TICK_INTERVAL_SECONDS,
  getSchedulerHostStatus,
  installSchedulerHost,
  syncSchedulerHost,
  uninstallSchedulerHost,
} from "@/lib/jobs/scheduler-host";

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "install": {
      await installSchedulerHost();
      console.log(
        `Scheduler host agents installed (${SCHEDULER_SERVER_AGENT_LABEL}, ${SCHEDULER_TICK_AGENT_LABEL} every ${SCHEDULER_TICK_INTERVAL_SECONDS}s on port ${SCHEDULER_SERVER_PORT})`
      );
      break;
    }
    case "uninstall": {
      await uninstallSchedulerHost();
      console.log("Scheduler host agents removed");
      break;
    }
    case "sync": {
      const result = await syncSchedulerHost();
      console.log(`Scheduler host sync: ${result}`);
      break;
    }
    case "status":
    default: {
      const status = await getSchedulerHostStatus();
      console.log(JSON.stringify({
        ...status,
        serverAgentLabel: SCHEDULER_SERVER_AGENT_LABEL,
        tickAgentLabel: SCHEDULER_TICK_AGENT_LABEL,
        tickIntervalSeconds: SCHEDULER_TICK_INTERVAL_SECONDS,
        serverPort: SCHEDULER_SERVER_PORT,
      }, null, 2));
      break;
    }
  }
}

main()
  .catch((error) => {
    console.error("Scheduler host command failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      (db as unknown as { $client: { close(): void } }).$client.close();
    } catch {
      // Read-only status checks can exit without a clean checkpoint.
    }
  });
