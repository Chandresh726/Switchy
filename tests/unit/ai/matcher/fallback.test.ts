import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/runtime", () => ({
  createAICapabilityRuntime: mocks.create,
  getAIExecutionErrorContext: (error: object) => error,
}));

import { createMatchRuntime, withMatchFallback } from "@/lib/ai/matcher/fallback";
import type { AICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";
import { AIError, AIRateLimitError } from "@/lib/ai/shared/errors";

const input = { schema: z.object({ score: z.number() }), instructions: "evaluate", prompt: "job",
  versions: { prompt: "v1", schema: "v1", policy: "v1" }, inputFingerprint: "a".repeat(64),
  policy: { maxAttempts: 10, timeoutMs: 1000, reasoningEffort: "medium" } };
const fallbackModel = { providerId: "backup", modelId: "backup-model", reasoningEffort: "low" };
const runtime = (executeStructured = vi.fn()) => ({ capability: "match_evaluation", snapshot: {
  providerRecordId: "primary", modelId: "primary-model", backendKind: "codex_cli", provider: "codex_cli",
}, executeStructured, reasoningEffort: "medium" }) as unknown as AICapabilityRuntime;

describe("matching fallback routing", () => {
  beforeEach(() => vi.clearAllMocks());
  it("resolves an alternate only when needed and bounds both model attempts", async () => {
    const primary = vi.fn().mockRejectedValue(Object.assign(new AIRateLimitError("limited"), { aiRunId: "original" }));
    const alternate = vi.fn().mockResolvedValue({ output: { score: 80 }, runId: "backup-run" });
    mocks.create.mockResolvedValue({ ...runtime(alternate), reasoningEffort: "low" });
    const routed = withMatchFallback(runtime(primary), fallbackModel);
    expect(mocks.create).not.toHaveBeenCalled();
    await expect(routed.executeStructured(input)).resolves.toMatchObject({ runId: "backup-run" });
    expect(primary.mock.calls[0][0].policy.maxAttempts).toBe(2);
    expect(alternate.mock.calls[0][0]).toMatchObject({ policy: { maxAttempts: 2, reasoningEffort: "low" },
      metadata: { fallbackUsed: true, fallbackReason: "rate_limit", fallbackFromRunId: "original" } });
    expect(alternate.mock.calls[0][0].schema).toBe(input.schema);
  });
  it.each([new DOMException("user cancelled", "AbortError"), new AIError({ type: "validation", message: "bad input" })])(
    "does not route cancelled or invalid input", async (error) => {
      const routed = withMatchFallback(runtime(vi.fn().mockRejectedValue(error)), fallbackModel);
      await expect(routed.executeStructured(input)).rejects.toBe(error);
      expect(mocks.create).not.toHaveBeenCalled();
    });
  it("preserves quota deferral when the fallback cannot be resolved", async () => {
    const rateLimit = new AIRateLimitError("limited", undefined, 60_000);
    mocks.create.mockRejectedValue(new AIError({ type: "invalid_model", message: "gone" }));
    await expect(withMatchFallback(runtime(vi.fn().mockRejectedValue(rateLimit)), fallbackModel).executeStructured(input)).rejects.toBe(rateLimit);
  });
  it("can use a fallback when the primary model fails during resolution", async () => {
    const alternate = vi.fn().mockResolvedValue({ output: { score: 80 } });
    mocks.create.mockRejectedValueOnce(new AIError({ type: "missing_api_key", message: "missing" }))
      .mockResolvedValueOnce(runtime(alternate));
    const routed = await createMatchRuntime({ capability: "match_evaluation" }, fallbackModel);
    await routed.executeStructured(input);
    expect(alternate.mock.calls[0][0].metadata).toMatchObject({ fallbackUsed: true, fallbackReason: "missing_api_key" });
  });
});
