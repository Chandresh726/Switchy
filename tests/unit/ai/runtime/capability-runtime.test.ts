import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  resolveAIContextForCapability: vi.fn(),
  createRun: vi.fn(),
  recordResolutionFailure: vi.fn(),
  completeSuccess: vi.fn(),
  completeFailure: vi.fn(),
}));

vi.mock("@/lib/ai/runtime-context", () => ({
  resolveAIContextForCapability: mocks.resolveAIContextForCapability,
}));

vi.mock("@/lib/ai/runtime/default-run-repository", () => ({
  aiRunRepository: {
    create: mocks.createRun,
    recordResolutionFailure: mocks.recordResolutionFailure,
    completeSuccess: mocks.completeSuccess,
    completeFailure: mocks.completeFailure,
  },
}));

import { createAICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";

function successfulProviderResult(
  text = "Generated text"
): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  };
}

function executionInput(overrides: {
  maxAttempts?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
} = {}) {
  return {
    instructions: "Write a concise response",
    prompt: "Untrusted source text",
    policy: {
      maxAttempts: overrides.maxAttempts ?? 1,
      timeoutMs: overrides.timeoutMs ?? 1_000,
      reasoningEffort: "medium" as const,
    },
    versions: { prompt: "p1", schema: "s1", policy: "e1" },
    inputFingerprint: "a".repeat(64),
    signal: overrides.signal,
  };
}

describe("AI capability runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRun.mockResolvedValue("run-1");
    mocks.recordResolutionFailure.mockResolvedValue("resolution-run-1");
    mocks.completeSuccess.mockResolvedValue(undefined);
    mocks.completeFailure.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function useModel(model: MockLanguageModelV4): void {
    mocks.resolveAIContextForCapability.mockResolvedValue({
      providerRecordId: "provider-1",
      providerId: "provider-1",
      provider: "openai",
      modelId: "gpt-test",
      model,
      providerOptions: undefined,
      reasoningEffort: "medium",
    });
  }

  it("records stable usage fields and makes one provider call for one attempt", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: successfulProviderResult(),
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({
      capability: "writing_cover_letter",
    });

    const result = await runtime.executeText(executionInput());

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(result).toMatchObject({
      output: "Generated text",
      runId: "run-1",
      attempts: 1,
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    });
    expect(mocks.completeSuccess).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        attempts: 1,
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      })
    );
  });

  it("records a sanitized failed run when model resolution fails", async () => {
    const resolutionError = new Error("provider rejected sk-super-secret");
    mocks.resolveAIContextForCapability.mockRejectedValue(resolutionError);

    await expect(
      createAICapabilityRuntime({
        capability: "writing_cover_letter",
        model: {
          providerId: "provider-1",
          modelId: "gpt-test",
          reasoningEffort: "medium",
        },
      })
    ).rejects.toBe(resolutionError);

    expect(mocks.recordResolutionFailure).toHaveBeenCalledWith({
      capability: "writing_cover_letter",
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      error: resolutionError,
    });
  });

  it("rejects a policy that differs from the resolved reasoning effort", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: successfulProviderResult(),
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({
      capability: "writing_cover_letter",
    });

    await expect(
      runtime.executeText({
        ...executionInput(),
        policy: {
          ...executionInput().policy,
          reasoningEffort: "low",
        },
      })
    ).rejects.toMatchObject({ type: "reasoning_not_supported" });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.completeFailure).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ attempts: 0, usage: {} })
    );
  });

  it("disables SDK retries inside the application attempt loop", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("temporary provider failure");
      },
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({
      capability: "writing_referral",
    });

    await expect(runtime.executeText(executionInput())).rejects.toThrow(
      "temporary provider failure"
    );

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(mocks.completeFailure).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ attempts: 1 })
    );
  });

  it("honors configured cancellable backoff and accumulates retry usage", async () => {
    vi.useFakeTimers();
    const model = new MockLanguageModelV4({
      doGenerate: [
        successfulProviderResult("too short"),
        successfulProviderResult("Complete generated response"),
      ],
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({
      capability: "writing_cover_letter",
    });
    const pending = runtime.executeText({
      ...executionInput({ maxAttempts: 2 }),
      retry: { baseDelayMs: 100, maxDelayMs: 100 },
      validate: (text) => text.startsWith("Complete"),
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(model.doGenerateCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(result).toMatchObject({
      attempts: 2,
      usage: { inputTokens: 24, outputTokens: 10, totalTokens: 34 },
    });
    expect(mocks.completeSuccess).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        attempts: 2,
        usage: { inputTokens: 24, outputTokens: 10, totalTokens: 34 },
      })
    );
  });

  it("records accumulated usage when the quality gate exhausts all attempts", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        successfulProviderResult("bad"),
        successfulProviderResult("still bad"),
      ],
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({
      capability: "writing_referral",
    });

    await expect(
      runtime.executeText({
        ...executionInput({ maxAttempts: 2 }),
        retry: { baseDelayMs: 0, maxDelayMs: 0 },
        validate: () => false,
      })
    ).rejects.toThrow("quality gate");

    expect(mocks.completeFailure).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        attempts: 2,
        usage: { inputTokens: 24, outputTokens: 10, totalTokens: 34 },
        finishReason: "stop",
        qualityResult: "failed",
      })
    );
  });

  it("captures lifecycle telemetry when structured output parsing fails", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: successfulProviderResult("not valid JSON"),
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({
      capability: "resume_parse",
    });

    await expect(
      runtime.executeStructured({
        ...executionInput(),
        schema: z.object({ name: z.string() }),
      })
    ).rejects.toThrow();

    expect(mocks.completeFailure).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        attempts: 1,
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        finishReason: "stop",
      })
    );
  });

  it("uses the AI SDK native timeout to abort the provider request", async () => {
    let providerAborted = false;
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () => {
              providerAborted = true;
              reject(abortSignal.reason);
            },
            { once: true }
          );
        }),
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({ capability: "resume_parse" });

    await expect(
      runtime.executeText(executionInput({ timeoutMs: 10 }))
    ).rejects.toThrow();

    expect(providerAborted).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("composes request cancellation into the provider signal", async () => {
    const started = Promise.withResolvers<void>();
    let providerAbortReason: unknown;
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          started.resolve();
          abortSignal?.addEventListener(
            "abort",
            () => {
              providerAbortReason = abortSignal.reason;
              reject(abortSignal.reason);
            },
            { once: true }
          );
        }),
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({ capability: "job_analysis" });
    const controller = new AbortController();
    const reason = new DOMException("request cancelled", "AbortError");
    const pending = runtime.executeText(
      executionInput({ signal: controller.signal })
    );

    await started.promise;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(providerAbortReason).toBe(reason);
    expect(mocks.completeFailure).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ attempts: 1, error: reason })
    );
  });

  it("records a pre-cancelled execution without calling the provider", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: successfulProviderResult(),
    });
    useModel(model);
    const runtime = await createAICapabilityRuntime({ capability: "job_analysis" });
    const controller = new AbortController();
    const reason = new DOMException("already cancelled", "AbortError");
    controller.abort(reason);

    await expect(
      runtime.executeText(executionInput({ signal: controller.signal }))
    ).rejects.toBe(reason);

    expect(mocks.createRun).toHaveBeenCalledTimes(1);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(mocks.completeFailure).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ attempts: 0, error: reason })
    );
  });
});
