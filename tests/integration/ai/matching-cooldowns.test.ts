import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { withMatchFallback } from "@/lib/ai/matcher/fallback";
import type { BackendResult } from "@/lib/ai/local-cli/types";
import { adaptiveProviderLimiter, resetAdaptiveProviderLimiter } from "@/lib/ai/runtime/adaptive-provider-limiter";
import { createAICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";
import { acquireMatchingProviderPermit } from "@/lib/ai/runtime/matching-provider-permit";
import { providerModelScope, providerQuotaScope } from "@/lib/ai/runtime/provider-scope";
import { createAIRunRepository } from "@/lib/ai/runtime/run-repository";
import type { ResolvedModelSnapshot } from "@/lib/ai/runtime/types";
import { AIRateLimitError } from "@/lib/ai/shared/errors";
import { aiRunAttempts, aiRuns } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const state = vi.hoisted(() => ({
  repository: undefined as unknown as ReturnType<typeof createAIRunRepository>,
  resolve: vi.fn(),
}));
vi.mock("@/lib/ai/runtime/default-run-repository", () => ({
  get aiRunRepository() { return state.repository; },
}));
vi.mock("@/lib/ai/runtime-context", () => ({ resolveAIContextForCapability: state.resolve }));

const harness = createSqliteTestHarness("switchy-model-cooldowns-");
const primary: ResolvedModelSnapshot = {
  providerRecordId: "builtin:opencode-cli", provider: "opencode_cli",
  backendKind: "opencode_cli", upstreamProvider: "opencode", modelId: "opencode/primary-free",
};
const fallback = { ...primary, modelId: "opencode/fallback-free" };
const account = providerQuotaScope(primary);
const acquire = (snapshot = primary, signal = new AbortController().signal) =>
  acquireMatchingProviderPermit(snapshot, 5, state.repository, signal);

describe("matching model cooldown routing", () => {
  let testDatabase: ReturnType<typeof harness.createDatabase>["database"];

  beforeEach(() => {
    resetAdaptiveProviderLimiter();
    state.resolve.mockReset();
    testDatabase = harness.createDatabase().database;
    state.repository = createAIRunRepository(testDatabase);
  });
  afterEach(() => { resetAdaptiveProviderLimiter(); vi.useRealTimers(); });

  it("routes concurrent matches to the fallback and records only actual provider attempts", async () => {
    const primaryCall = vi.fn().mockRejectedValue(new AIRateLimitError("limited", undefined, 120_000));
    const response = { output: '{"ok":true}', usage: {}, warningCodes: [] };
    let completeFallback: ((value: BackendResult<string>) => void) | undefined;
    const fallbackCall = vi.fn().mockImplementationOnce(() => new Promise((resolve) => {
      completeFallback = resolve;
    })).mockResolvedValue(response);
    const context = (snapshot: ResolvedModelSnapshot, generateText: typeof primaryCall) => ({
      ...snapshot, providerId: snapshot.providerRecordId,
      backend: { generateText, validateConfiguration: vi.fn() },
    });
    state.resolve.mockImplementation((_capability, model) => context(
      model?.modelId === fallback.modelId ? fallback : primary,
      model?.modelId === fallback.modelId ? fallbackCall : primaryCall,
    ));
    const runtime = withMatchFallback(await createAICapabilityRuntime({
      capability: "job_analysis", providerConcurrencyLimit: 5,
    }), { providerId: fallback.providerRecordId, modelId: fallback.modelId });
    const input = {
      instructions: "Analyze", prompt: "Job", schema: z.object({ ok: z.boolean() }),
      policy: { maxAttempts: 2, timeoutMs: 5_000 },
      versions: { prompt: "p1", schema: "s1", policy: "e1" }, inputFingerprint: "a".repeat(64),
    };
    const executions = [runtime.executeStructured(input), runtime.executeStructured(input), runtime.executeStructured(input)];
    await vi.waitFor(() => expect(fallbackCall).toHaveBeenCalledTimes(1));
    expect(primaryCall).toHaveBeenCalledTimes(1);
    expect(adaptiveProviderLimiter.getSnapshot(account)?.active).toBe(1);
    completeFallback!(response);
    const results = await Promise.all(executions);
    expect(results.every((result) => result.output.ok && result.resolvedModel?.modelId === fallback.modelId)).toBe(true);
    expect(fallbackCall).toHaveBeenCalledTimes(3);
    expect(await testDatabase.select().from(aiRunAttempts)).toHaveLength(4);
    const runs = await testDatabase.select().from(aiRuns);
    expect(runs.filter((run) => run.modelId === primary.modelId).map((run) => run.attemptCount).sort()).toEqual([0, 0, 1]);
    expect(runs.filter((run) => run.modelId === fallback.modelId).every((run) => run.status === "succeeded")).toBe(true);
    await expect(acquire()).rejects.toMatchObject({ type: "rate_limit" });
  });

  it("escalates two actual model limits to an account cooldown and restores it after restart", async () => {
    const first = await acquire();
    await first.failure(new AIRateLimitError("limited", undefined, 120_000));
    const second = await acquire(fallback);
    const waiting = acquire(fallback);
    const rejected = expect(waiting).rejects.toMatchObject({ type: "rate_limit" });
    await second.failure(new AIRateLimitError("also limited", undefined, 180_000));
    await rejected;
    const until = await state.repository.getProviderCooldown(`${account}:account`);
    expect(until).toBeGreaterThanOrEqual(Date.now() + 179_000);
    resetAdaptiveProviderLimiter();
    await expect(acquire({ ...fallback, modelId: "opencode/third-free" })).rejects.toMatchObject({ type: "rate_limit" });
    expect(await state.repository.getProviderCooldown(`${account}:account`)).toBe(until);
    (await acquire({ ...fallback, upstreamProvider: "other", modelId: "other/free" })).success();
  });

  it("preserves a model cooldown across restart without blocking a healthy fallback", async () => {
    await state.repository.setProviderCooldown(account, Date.now() + 3_600_000);
    await (await acquire()).failure(new AIRateLimitError("limited", undefined, 120_000));
    resetAdaptiveProviderLimiter();
    await expect(acquire()).rejects.toMatchObject({ type: "rate_limit" });
    (await acquire(fallback)).success();
  });

  it("blocks every model immediately for an explicit account limit", async () => {
    await (await acquire()).failure(new AIRateLimitError("account quota exhausted", undefined, 240_000, "account"));
    await expect(acquire(fallback)).rejects.toMatchObject({ type: "rate_limit" });
  });

  it("does not extend cooldowns for locally blocked requests and admits one recovery probe", async () => {
    vi.useFakeTimers();
    await (await acquire()).failure(new AIRateLimitError("limited", undefined, 120_000));
    await (await acquire(fallback)).failure(new AIRateLimitError("limited", undefined, 180_000));
    const until = await state.repository.getProviderCooldown(`${account}:account`);
    for (let index = 0; index < 5; index++) {
      await expect(acquire(fallback)).rejects.toMatchObject({ type: "rate_limit" });
    }
    expect(await state.repository.getProviderCooldown(`${account}:account`)).toBe(until);
    await vi.advanceTimersByTimeAsync(Math.ceil(until - Date.now()));
    const probe = await acquire(fallback);
    const waiting = acquire(fallback);
    await Promise.resolve();
    expect(adaptiveProviderLimiter.getSnapshot(account)?.active).toBe(1);
    probe.success();
    (await waiting).success();
  });

  it("does not penalize a model when its queued account permit is cancelled", async () => {
    const active = await acquire();
    const controller = new AbortController();
    const waiting = acquire(fallback, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(adaptiveProviderLimiter.getSnapshot(account)?.waiting).toBe(1));
    controller.abort();
    await rejected;
    expect(adaptiveProviderLimiter.getSnapshot(providerModelScope(account, fallback.modelId))).toMatchObject({ active: 0, cooldownUntil: 0 });
    active.success();
    (await acquire(fallback)).success();
  });
});
