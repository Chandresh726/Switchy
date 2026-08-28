import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  notInArray,
  or,
} from "drizzle-orm";

import { ValidationError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  aiWorkItems,
  companies,
  jobs,
  matchLogs,
  matchResults,
  matchSessions,
  notificationDeliveries,
  scrapeSessions,
  scrapingLogs,
  settings as settingsTable,
} from "@/lib/db/schema";
import { ScheduledSingleFlightDispatcher } from "@/lib/scraper/runtime/single-flight-dispatcher";
import { getSettingsWithDefaults } from "@/lib/settings/settings-service";

import { sendNativeNotification } from "./native-notifier";

const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_RETRY_DELAY_MS = 5 * 60 * 1_000;
const DELIVERY_BATCH_SIZE = 100;

interface NotificationDispatchSummary {
  sent: number;
  nextRunAt: Date | null;
}

export async function sendNotificationTest(): Promise<{ success: true; message: string }> {
  const settings = await getSettingsWithDefaults();
  if (settings.notifications_enabled !== "true") {
    throw new ValidationError(
      "Enable job match notifications before sending a test.",
      "notifications_disabled",
      400
    );
  }
  await sendNativeNotification({
    title: "Switchy notifications are ready",
    body: "You’ll be notified when an automatic scrape finds jobs above your match threshold.",
    path: "/settings",
  });
  return { success: true, message: "Test notification sent" };
}

/**
 * Fire-and-forget reconciliation for callers that must not fail because a
 * notification could not be delivered.
 */
function notificationBody(best: { title: string; companyName: string; score: number }, count: number): string {
  const summary = `${best.title} at ${best.companyName} · ${Math.round(best.score)}% match`;
  return count === 1 ? summary : `Best: ${summary}. Open Switchy to review all ${count}.`;
}

/**
 * A batch can span many deliveries, so the opt-out switch is re-read between
 * them. This is a primary-key lookup against a local SQLite file, and it stops
 * a long batch from firing alerts the user has already turned off.
 */
async function notificationsAreEnabled(): Promise<boolean> {
  const preference = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "notifications_enabled"))
    .get();
  return preference?.value === "true";
}

async function getNextDeliveryRetryAt(enabledAt: Date): Promise<Date | null> {
  if (!await notificationsAreEnabled()) return null;
  const next = await db.select({ updatedAt: notificationDeliveries.updatedAt })
    .from(notificationDeliveries)
    .innerJoin(
      scrapeSessions,
      eq(notificationDeliveries.scrapeSessionId, scrapeSessions.id)
    )
    .where(and(
      inArray(notificationDeliveries.status, ["pending", "failed"]),
      lt(notificationDeliveries.attemptCount, MAX_DELIVERY_ATTEMPTS),
      inArray(scrapeSessions.triggerSource, ["scheduler", "scheduler_recovery"]),
      inArray(scrapeSessions.status, ["completed", "partial"]),
      gte(scrapeSessions.completedAt, enabledAt)
    ))
    .orderBy(asc(notificationDeliveries.updatedAt))
    .limit(1)
    .get();
  if (!next) return null;
  return new Date(Math.max(
    Date.now(),
    next.updatedAt.getTime() + DELIVERY_RETRY_DELAY_MS
  ));
}

async function runScheduledMatchNotifications(): Promise<NotificationDispatchSummary> {
  const settings = await getSettingsWithDefaults();
  if (settings.notifications_enabled !== "true") {
    return { sent: 0, nextRunAt: null };
  }

  const enabledAt = new Date(settings.notifications_enabled_at);
  if (Number.isNaN(enabledAt.getTime())) {
    return { sent: 0, nextRunAt: null };
  }

  const threshold = Number(settings.notifications_match_score_threshold);
  const retryBefore = new Date(Date.now() - DELIVERY_RETRY_DELAY_MS);
  const candidates = await db.select({
    id: scrapeSessions.id,
    deliveryId: notificationDeliveries.id,
    deliveryStatus: notificationDeliveries.status,
    deliveryAttemptCount: notificationDeliveries.attemptCount,
  }).from(scrapeSessions)
    .leftJoin(
      notificationDeliveries,
      eq(notificationDeliveries.scrapeSessionId, scrapeSessions.id)
    )
    .where(and(
      inArray(scrapeSessions.triggerSource, ["scheduler", "scheduler_recovery"]),
      inArray(scrapeSessions.status, ["completed", "partial"]),
      gte(scrapeSessions.completedAt, enabledAt),
      notExists(
        db.select({ id: matchSessions.id })
          .from(aiWorkItems)
          .innerJoin(
            scrapingLogs,
            eq(aiWorkItems.scrapingLogId, scrapingLogs.id)
          )
          .innerJoin(matchSessions, eq(aiWorkItems.matchSessionId, matchSessions.id))
          .where(and(
            eq(scrapingLogs.sessionId, scrapeSessions.id),
            eq(aiWorkItems.workType, "match_jobs"),
            notInArray(matchSessions.status, ["completed", "failed", "cancelled"])
          ))
      ),
      or(
        isNull(notificationDeliveries.id),
        // A claimed row that never reached a terminal state (process died
        // mid-send) is retried on the same budget as an outright failure.
        and(
          inArray(notificationDeliveries.status, ["pending", "failed"]),
          lt(notificationDeliveries.attemptCount, MAX_DELIVERY_ATTEMPTS),
          lte(notificationDeliveries.updatedAt, retryBefore)
        )
      )
    ))
    .orderBy(desc(scrapeSessions.completedAt))
    .limit(DELIVERY_BATCH_SIZE);

  let sent = 0;
  let stoppedAfterOptOut = false;
  for (const candidate of candidates) {
    const matches = await db.select({
      jobId: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      score: matchLogs.score,
    }).from(matchLogs)
      .innerJoin(aiWorkItems, eq(matchLogs.sessionId, aiWorkItems.matchSessionId))
      .innerJoin(scrapingLogs, eq(aiWorkItems.scrapingLogId, scrapingLogs.id))
      .innerJoin(jobs, eq(matchLogs.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .innerJoin(matchResults, eq(matchLogs.matchResultId, matchResults.id))
      .where(and(
        eq(scrapingLogs.sessionId, candidate.id),
        eq(aiWorkItems.workType, "match_jobs"),
        eq(matchLogs.status, "success"),
        gte(matchLogs.score, threshold),
        eq(matchResults.isStale, false)
      ));

    const uniqueMatches = [...new Map(matches.flatMap((match) =>
      match.score === null ? [] : [[match.jobId, { ...match, score: match.score }] as const]
    )).values()].sort((a, b) => b.score - a.score);
    const best = uniqueMatches[0];

    if (!await notificationsAreEnabled()) {
      stoppedAfterOptOut = true;
      break;
    }

    // The attempt is counted when the row is claimed, not when it settles, so
    // that a crash between claiming and sending still consumes retry budget.
    const deliveryId = candidate.deliveryId ?? crypto.randomUUID();
    const attemptCount = (candidate.deliveryAttemptCount ?? 0) + 1;
    const claim = {
      threshold,
      matchCount: uniqueMatches.length,
      bestJobId: best?.jobId ?? null,
      status: "pending" as const,
      attemptCount,
      updatedAt: new Date(),
    };

    let claimed = false;
    if (!candidate.deliveryId) {
      const inserted = await db.insert(notificationDeliveries)
        .values({ id: deliveryId, scrapeSessionId: candidate.id, ...claim })
        .onConflictDoNothing()
        .returning({ id: notificationDeliveries.id });
      claimed = inserted.length === 1;
    } else if (candidate.deliveryStatus) {
      const updated = await db.update(notificationDeliveries).set(claim).where(and(
        eq(notificationDeliveries.id, candidate.deliveryId),
        eq(notificationDeliveries.status, candidate.deliveryStatus),
        eq(notificationDeliveries.attemptCount, attemptCount - 1),
        lte(notificationDeliveries.updatedAt, retryBefore)
      )).returning({ id: notificationDeliveries.id });
      claimed = updated.length === 1;
    }
    if (!claimed) continue;

    if (!best) {
      await db.update(notificationDeliveries).set({
        status: "skipped",
        lastError: null,
        updatedAt: new Date(),
      }).where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, "pending")
      ));
      continue;
    }

    try {
      await sendNativeNotification({
        title: uniqueMatches.length === 1
          ? "New profile match found"
          : `${uniqueMatches.length} new profile matches found`,
        body: notificationBody(best, uniqueMatches.length),
        path: `/jobs?scrapeSessionId=${encodeURIComponent(candidate.id)}&minScore=${threshold}&sortBy=matchScore&sortOrder=desc`,
      });
      await db.update(notificationDeliveries).set({
        status: "sent",
        deliveredAt: new Date(),
        updatedAt: new Date(),
        lastError: null,
      }).where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, "pending")
      ));
      sent += 1;
    } catch (error) {
      await db.update(notificationDeliveries).set({
        status: "failed",
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Native notification delivery failed",
        updatedAt: new Date(),
      }).where(and(
        eq(notificationDeliveries.id, deliveryId),
        eq(notificationDeliveries.status, "pending")
      ));
      console.error(
        `[Notifications] Failed to deliver scheduled scrape notification for ${candidate.id}:`,
        error
      );
    }
  }
  if (stoppedAfterOptOut) return { sent, nextRunAt: null };
  const retryAt = await getNextDeliveryRetryAt(enabledAt);
  const hasAnotherEligibleBatch = candidates.length === DELIVERY_BATCH_SIZE;
  return {
    sent,
    nextRunAt: hasAnotherEligibleBatch ? new Date() : retryAt,
  };
}

const scheduledNotificationDispatcher = new ScheduledSingleFlightDispatcher({
  run: runScheduledMatchNotifications,
  getNextRunAt: (summary) => summary.nextRunAt,
  failureRetryMs: DELIVERY_RETRY_DELAY_MS,
  onError: (error) => {
    console.error("[Notifications] Scheduled reconciliation failed:", error);
  },
});

/**
 * Fire-and-forget reconciliation for callers that must not fail because a
 * notification could not be delivered. The single-flight dispatcher retains
 * the next persisted retry time after the initiating scrape or match run ends.
 */
export async function reconcileMatchNotifications(): Promise<void> {
  try {
    await scheduledNotificationDispatcher.request();
  } catch {
    // The dispatcher logs and schedules infrastructure failures itself.
  }
}

export async function dispatchScheduledMatchNotifications(): Promise<number> {
  return (await runScheduledMatchNotifications()).sent;
}
