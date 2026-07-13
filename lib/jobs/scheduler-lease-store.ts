import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const SCHEDULER_LOCK_KEY = "scheduler.lock";
const SCHEDULER_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

interface SchedulerLockPayload {
  ownerId: string;
  token: string;
  expiresAt: number;
}

export interface SchedulerLeaseStore {
  acquire(ownerId: string): Promise<string | null>;
  refresh(lockToken: string): Promise<string | null>;
  release(lockToken: string): Promise<void>;
}

function parseSchedulerLock(value: string | null): SchedulerLockPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SchedulerLockPayload;
    if (
      typeof parsed.ownerId !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export class DrizzleSchedulerLeaseStore implements SchedulerLeaseStore {
  constructor(
    private readonly database: typeof db = db,
    private readonly leaseDurationMs = SCHEDULER_LOCK_TIMEOUT_MS
  ) {}

  async acquire(ownerId: string): Promise<string | null> {
    const now = Date.now();
    const currentRaw = await this.getValue();
    const currentLock = parseSchedulerLock(currentRaw);
    if (currentLock && currentLock.expiresAt > now) return null;

    const token = crypto.randomUUID();
    const nextRaw = JSON.stringify({
      ownerId,
      token,
      expiresAt: now + this.leaseDurationMs,
    } satisfies SchedulerLockPayload);

    if (!currentRaw) {
      await this.database
        .insert(settings)
        .values({
          key: SCHEDULER_LOCK_KEY,
          value: nextRaw,
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    } else {
      await this.database
        .update(settings)
        .set({ value: nextRaw, updatedAt: new Date() })
        .where(
          and(
            eq(settings.key, SCHEDULER_LOCK_KEY),
            eq(settings.value, currentRaw)
          )
        );
    }

    return (await this.getValue()) === nextRaw ? token : null;
  }

  async refresh(lockToken: string): Promise<string | null> {
    const currentRaw = await this.getValue();
    const currentLock = parseSchedulerLock(currentRaw);
    if (!currentRaw || !currentLock || currentLock.token !== lockToken) {
      return null;
    }

    const nextRaw = JSON.stringify({
      ...currentLock,
      expiresAt: Date.now() + this.leaseDurationMs,
    } satisfies SchedulerLockPayload);
    await this.database
      .update(settings)
      .set({ value: nextRaw, updatedAt: new Date() })
      .where(
        and(
          eq(settings.key, SCHEDULER_LOCK_KEY),
          eq(settings.value, currentRaw)
        )
      );

    return (await this.getValue()) === nextRaw ? lockToken : null;
  }

  async release(lockToken: string): Promise<void> {
    const currentRaw = await this.getValue();
    const currentLock = parseSchedulerLock(currentRaw);
    if (!currentRaw || !currentLock || currentLock.token !== lockToken) return;

    await this.database
      .delete(settings)
      .where(
        and(
          eq(settings.key, SCHEDULER_LOCK_KEY),
          eq(settings.value, currentRaw)
        )
      );
  }

  private async getValue(): Promise<string | null> {
    const rows = await this.database
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SCHEDULER_LOCK_KEY))
      .limit(1);
    return rows[0]?.value ?? null;
  }
}

let defaultStore: SchedulerLeaseStore | null = null;

export function getSchedulerLeaseStore(): SchedulerLeaseStore {
  defaultStore ??= new DrizzleSchedulerLeaseStore();
  return defaultStore;
}
