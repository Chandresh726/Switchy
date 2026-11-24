const ACTIVE_SESSION_STATUSES = new Set(["queued", "in_progress"]);

export function historyPollingInterval(
  sessions: ReadonlyArray<{ status: string }>
): 1_000 | false {
  return sessions.some((session) => ACTIVE_SESSION_STATUSES.has(session.status))
    ? 1_000
    : false;
}

export function sessionPollingInterval(progress?: { status: string; nextAttemptAt?: string | Date | null; hasActiveWork?: boolean }): number | false {
  if (!progress) return 1_000;
  if (!ACTIVE_SESSION_STATUSES.has(progress.status) && !progress.hasActiveWork) return false;
  const next = progress.nextAttemptAt ? new Date(progress.nextAttemptAt).getTime() - Date.now() : 0;
  return next > 1_000 ? Math.min(15_000, Math.max(1_000, next)) : 1_000;
}
