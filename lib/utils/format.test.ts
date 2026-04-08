import { describe, expect, it } from "vitest";

import { groupSessionsByDate } from "@/lib/utils/format";

describe("groupSessionsByDate", () => {
  it("groups skipped sessions by scheduledForAt when present", () => {
    const sessions = [
      {
        id: "skipped",
        scheduledForAt: "2026-04-06T23:50:00.000Z",
        startedAt: "2026-04-07T00:05:00.000Z",
        completedAt: "2026-04-07T00:05:00.000Z",
      },
    ];

    const groups = groupSessionsByDate(sessions);
    const labels = Array.from(groups.keys());

    expect(labels).toContain("Yesterday");
    expect(labels).not.toContain("Today");
  });
});
