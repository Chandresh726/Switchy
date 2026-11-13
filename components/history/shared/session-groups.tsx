import type { ReactNode } from "react";

import { groupSessionsByDate } from "@/lib/utils/format";

interface SessionGroupsProps<T> {
  sessions: T[];
  renderSession: (session: T) => ReactNode;
}

export const SessionGroups = <
  T extends Parameters<typeof groupSessionsByDate>[0][number],
>({
  sessions,
  renderSession,
}: SessionGroupsProps<T>) => (
  <>
    {Array.from(groupSessionsByDate(sessions), ([date, dateSessions]) => (
      <div
        key={date}
        className="animate-in fade-in slide-in-from-bottom-4 duration-500"
      >
        <h3 className="sticky top-0 z-10 mb-3 border-b border-border/60 bg-background/95 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur-sm supports-backdrop-filter:bg-background/80">
          {date}
        </h3>
        <div className="space-y-3">{dateSessions.map(renderSession)}</div>
      </div>
    ))}
  </>
);
