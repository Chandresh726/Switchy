import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mocks.insert,
  },
}));

import { insertAICacheHit } from "@/lib/ai/observability/cache-events";
import { db } from "@/lib/db";

describe("AI cache events", () => {
  const run = vi.fn();
  const values = vi.fn(() => ({ run }));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values });
  });

  it("maps a cache hit to one reusable persistence record", () => {
    const createdAt = new Date("2026-07-29T12:00:00.000Z");

    const id = insertAICacheHit({
      capability: "match_evaluation",
      subject: { type: "job", id: "42" },
      sourceRunId: "run-1",
      artifact: { type: "match_result", id: "result-1" },
      sessionId: "session-1",
    }, db, {
      id: "cache-event-1",
      createdAt,
    });

    expect(id).toBe("cache-event-1");
    expect(values).toHaveBeenCalledWith({
      id: "cache-event-1",
      capability: "match_evaluation",
      subjectType: "job",
      subjectId: "42",
      sourceRunId: "run-1",
      artifactType: "match_result",
      artifactId: "result-1",
      sessionId: "session-1",
      createdAt,
    });
    expect(run).toHaveBeenCalledOnce();
  });
});
