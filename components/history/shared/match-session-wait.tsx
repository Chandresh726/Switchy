import type { MatchHistorySession } from "@/lib/api/contracts/history";
import { formatDateTime } from "@/lib/utils/format";

export function MatchSessionWait({ session }: { session: MatchHistorySession }) {
  if (session.status !== "queued" || !session.nextAttemptAt) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground" role="status">
      {session.waitReason || "Waiting to retry."}{" "}
      Retry at {formatDateTime(session.nextAttemptAt)}
    </p>
  );
}
