import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queueProfileRematchWork: vi.fn(),
  rows: [] as Array<{ jobId: number }>,
}));

vi.mock("@/lib/ai/work-items/service", () => ({
  queueProfileRematchWork: mocks.queueProfileRematchWork,
}));

vi.mock("@/lib/db", () => ({
  db: {
    selectDistinct: () => ({
      from: async () => mocks.rows,
    }),
  },
}));

import { scheduleProfileRematch } from "@/lib/ai/matcher/profile-rematch";

describe("profile update rematching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
  });

  it("durably queues only currently matched jobs before returning", async () => {
    mocks.rows = [{ jobId: 12 }, { jobId: 19 }];

    await scheduleProfileRematch();

    expect(mocks.queueProfileRematchWork).toHaveBeenCalledWith([12, 19]);
  });

  it("does not create empty work when no job has a match", async () => {
    await scheduleProfileRematch();

    expect(mocks.queueProfileRematchWork).not.toHaveBeenCalled();
  });
});
