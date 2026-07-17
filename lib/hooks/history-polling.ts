const ACTIVE_SESSION_STATUSES = new Set(["queued", "in_progress"]);

export function historyPollingInterval(
  sessions: ReadonlyArray<{ status: string }>
): 1_000 | false {
  return sessions.some((session) => ACTIVE_SESSION_STATUSES.has(session.status))
    ? 1_000
    : false;
}
