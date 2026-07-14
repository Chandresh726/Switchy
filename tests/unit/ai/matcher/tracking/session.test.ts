import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: mocks.update,
    transaction: mocks.transaction,
  },
}));

import {
  persistMatchSuccess,
  updateJobWithMatchResult,
} from "@/lib/ai/matcher/tracking/session";

const result = {
  score: 84,
  reasons: ["Strong fit"],
  matchedSkills: ["TypeScript"],
  missingSkills: [],
  recommendations: ["Apply"],
};

describe("match persistence timestamps", () => {
  const jobSet = vi.fn();
  const transactionJobSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    jobSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mocks.update.mockReturnValue({ set: jobSet });
    transactionJobSet.mockReturnValue({ where: vi.fn(() => ({ run: vi.fn() })) });
    mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({
      update: vi.fn(() => ({ set: transactionJobSet })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ run: vi.fn() })) })),
    }));
  });

  it("does not alter jobs.updatedAt for a direct match-only update", async () => {
    await updateJobWithMatchResult(1, result);

    expect(jobSet).toHaveBeenCalledWith(expect.objectContaining({ matchScore: 84 }));
    expect(jobSet.mock.calls[0][0]).not.toHaveProperty("updatedAt");
  });

  it("does not alter jobs.updatedAt for a session match-only update", async () => {
    await persistMatchSuccess("session-1", 1, result, 1, 100, "model-1");

    expect(transactionJobSet).toHaveBeenCalledWith(
      expect.objectContaining({ matchScore: 84 })
    );
    expect(transactionJobSet.mock.calls[0][0]).not.toHaveProperty("updatedAt");
  });
});
