import { afterEach, describe, expect, it, vi } from "vitest";

import { formatFileSize, groupSessionsByDate } from "@/lib/utils/format";

describe("formatFileSize", () => {
  it("formats byte, kilobyte, and megabyte values", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2_048)).toBe("2.0 KB");
    expect(formatFileSize(2 * 1_024 * 1_024)).toBe("2.0 MB");
    expect(formatFileSize(null)).toBe("-");
  });
});

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
