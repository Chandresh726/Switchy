import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.insert,
  },
}));

import { persistMatchSuccess } from "@/lib/ai/matcher/tracking/session";

const result = {
  score: 84,
  reasons: ["Strong fit"],
  matchedSkills: ["TypeScript"],
  missingSkills: [],
  recommendations: ["Apply"],
};

describe("match session logging", () => {
  const values = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    values.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values });
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
