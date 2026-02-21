export function formatDurationMs(ms: number | null): string {
  if (ms == null || ms <= 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function formatDurationFromDates(
  startedAt: Date | null,
  completedAt: Date | null
): string {
  if (!startedAt) return "-";
  const end = completedAt ? new Date(completedAt) : new Date();
  const start = new Date(startedAt);
  const diffMs = end.getTime() - start.getTime();

  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  return `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`;
}

export function formatTime(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface SessionWithDates {
  startedAt: Date | null;
  completedAt: Date | null;
}

export function groupSessionsByDate<T extends SessionWithDates>(
  sessions: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const session of sessions) {
    const referenceDate = session.startedAt || session.completedAt;
    if (!referenceDate) {
      const pendingLabel = "Pending";
      if (!groups.has(pendingLabel)) {
        groups.set(pendingLabel, []);
      }
      groups.get(pendingLabel)!.push(session);
      continue;
    }

    const sessionDate = new Date(referenceDate);
    let label: string;

    if (sessionDate.toDateString() === today.toDateString()) {
      label = "Today";
    } else if (sessionDate.toDateString() === yesterday.toDateString()) {
      label = "Yesterday";
    } else {
      label = sessionDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(session);
  }

  return groups;
}
