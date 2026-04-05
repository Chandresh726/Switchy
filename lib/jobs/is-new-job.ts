const NEW_JOB_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isNewJob({
  discoveredAt,
  viewedAt,
  status,
  currentTime,
}: {
  discoveredAt: string | null;
  viewedAt: string | null;
  status: string;
  currentTime: number;
}): boolean {
  if (status !== "new" || viewedAt || !discoveredAt) {
    return false;
  }

  const discoveredTime = new Date(discoveredAt).getTime();
  if (Number.isNaN(discoveredTime)) {
    return false;
  }

  return currentTime - discoveredTime <= NEW_JOB_WINDOW_MS;
}
