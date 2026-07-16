import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
}));

import { persistMatchSuccess } from "@/lib/ai/matcher/tracking/session";

const result = {
  score: 84,
  reasons: ["Strong fit"],
  matchedSkills: ["TypeScript"],
};

describe("match session logging", () => {
  const values = vi.fn();
  const set = vi.fn();
  const where = vi.fn();
  const run = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    run.mockReturnValue(undefined);
    values.mockReturnValue({ run });
    where.mockReturnValue({ run });
    set.mockReturnValue({ where });
    mocks.insert.mockReturnValue({ values });
    mocks.update.mockReturnValue({ set });
    mocks.transaction.mockImplementation((callback) => callback({
      insert: mocks.insert,
      update: mocks.update,
    }));
  });

  it("records session progress without writing legacy job match columns", async () => {
    await persistMatchSuccess(
      "session-1",
      1,
      "match-result-1",
      result,
      1,
      100,
      "model-1"
    );

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      jobId: 1,
      matchResultId: "match-result-1",
      score: 84,
    }));
  });
});
