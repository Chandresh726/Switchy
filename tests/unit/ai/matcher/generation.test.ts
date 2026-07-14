import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { generateStructured } from "@/lib/ai/matcher/generation";

describe("generateStructured", () => {
  it("forwards cancellation and execution metadata to the capability runtime", async () => {
    const executeStructured = vi.fn().mockResolvedValue({
      output: { score: 90 },
      runId: "run-1",
      attempts: 1,
      usage: {},
      durationMs: 5,
      finishReason: "stop",
    });
    const controller = new AbortController();

    const result = await generateStructured({
      runtime: { executeStructured } as never,
      schema: z.object({ score: z.number() }),
      instructions: "Score the role",
      prompt: "Role details",
      policy: {
        maxAttempts: 1,
        timeoutMs: 30_000,
        reasoningEffort: "medium",
      },
      subject: { type: "job", id: "11" },
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      policyVersion: "policy-v1",
      signal: controller.signal,
    });

    expect(executeStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: controller.signal,
        subject: { type: "job", id: "11" },
        versions: {
          prompt: "prompt-v1",
          schema: "schema-v1",
          policy: "policy-v1",
        },
      })
    );
    expect(result).toEqual({ data: { score: 90 }, runId: "run-1", attempts: 1 });
  });
});
