import { afterEach, describe, expect, it, vi } from "vitest";

import { groupSessionsByDate } from "@/lib/utils/format";

describe("groupSessionsByDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups skipped sessions by scheduledForAt when present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 8, 12));
    const sessions = [
      {
        id: "skipped",
        scheduledForAt: new Date(2026, 3, 7, 23, 50).toISOString(),
        startedAt: new Date(2026, 3, 8, 0, 5),
        completedAt: new Date(2026, 3, 8, 0, 5),
      },
    ];

    const groups = groupSessionsByDate(sessions);
    const labels = Array.from(groups.keys());

    expect(labels).toContain("Yesterday");
    expect(labels).not.toContain("Today");
  });
});
