import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  createDeviceSleepInhibitor,
  type DeviceSleepInhibitor,
  type DeviceSleepInhibitorLease,
} from "@/lib/scraper/runtime/device-sleep-inhibitor";

import { processSingleton } from "./process-singleton";

// Preserve existing preferences and API compatibility with the original setting.
const KEEP_DEVICE_AWAKE_KEY = "scraper_keep_device_awake";

export class ActivitySleepInhibitor implements DeviceSleepInhibitor {
  private readonly activities = new Set<symbol>();
  private lease: DeviceSleepInhibitorLease | null = null;
  private tail: Promise<void> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = true;
  private initialized = false;

  constructor(
    private readonly inhibitor: DeviceSleepInhibitor,
    private readonly readEnabled: () => Promise<boolean>
  ) {}

  async acquire(): Promise<DeviceSleepInhibitorLease> {
    const activity = Symbol();
    this.activities.add(activity);
    this.clearIdleTimer();
    await this.serialize(async () => {
      if (!this.initialized) await this.loadSetting();
      await this.synchronize();
    });
    return {
      release: async () => {
        if (!this.activities.delete(activity)) return;
        await this.serialize(async () => {
          if (this.activities.size > 0) return;
          // Keep one assertion across adjacent company tasks and the handoff
          // from scraping to matching without extending long retry waits.
          this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            void this.serialize(() => this.synchronize());
          }, 1_000);
          this.idleTimer.unref();
        });
      },
    };
  }

  async refresh(): Promise<void> {
    await this.serialize(async () => {
      await this.loadSetting();
      await this.synchronize();
    });
  }

  private async loadSetting(): Promise<void> {
    try {
      this.enabled = await this.readEnabled();
      this.initialized = true;
    } catch (error) {
      this.initialized = true;
      console.warn("[ActivitySleepInhibitor] Failed to read keep-awake setting:", error);
    }
  }

  private async synchronize(): Promise<void> {
    if (this.enabled && this.activities.size > 0) {
      if (!this.lease) this.lease = await this.inhibitor.acquire();
    } else if (this.lease) {
      const lease = this.lease;
      this.lease = null;
      await lease.release();
    }
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    this.tail = this.tail.then(work).catch((error) => {
      console.warn("[ActivitySleepInhibitor] Failed to update sleep protection:", error);
    });
    return this.tail;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

export function getActivitySleepInhibitor(): ActivitySleepInhibitor {
  return processSingleton("activitySleepInhibitor", () => new ActivitySleepInhibitor(
    createDeviceSleepInhibitor(),
    async () => {
      const row = await db.select({ value: settings.value }).from(settings)
        .where(eq(settings.key, KEEP_DEVICE_AWAKE_KEY)).get();
      return row?.value !== "false";
    }
  ));
}

export async function withSleepProtection<T>(
  inhibitor: DeviceSleepInhibitor,
  work: () => Promise<T>
): Promise<T> {
  let lease: DeviceSleepInhibitorLease | undefined;
  try {
    lease = await inhibitor.acquire();
  } catch (error) {
    console.warn("[ActivitySleepInhibitor] Failed to acquire sleep protection:", error);
  }
  try {
    return await work();
  } finally {
    try {
      await lease?.release();
    } catch (error) {
      console.warn("[ActivitySleepInhibitor] Failed to release sleep protection:", error);
    }
  }
}
