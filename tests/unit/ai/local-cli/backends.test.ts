import { chmod, realpath } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as openCodeSDK from "@opencode-ai/sdk/v2";

import { CodexCLIBackend } from "@/lib/ai/local-cli/codex-backend";
import { OpenCodeCLIBackend } from "@/lib/ai/local-cli/opencode-backend";

const fixtures = path.join(process.cwd(), "tests", "fixtures", "ai");
const codexExecutable = path.join(fixtures, "fake-codex-cli.mjs");
const openCodeExecutable = path.join(fixtures, "fake-opencode-cli.mjs");

function baseInput() {
  return {
    instructions: "Return the requested fixture response.",
    prompt: "Synthetic untrusted input",
    modelId: "gpt-visible",
    reasoningEffort: "medium" as const,
    timeoutMs: 2_000,
    signal: new AbortController().signal,
  };
}

beforeAll(async () => {
  await Promise.all([
    chmod(await realpath(codexExecutable), 0o755),
    chmod(await realpath(openCodeExecutable), 0o755),
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Codex CLI backend", () => {
  it("waits for initialization before serving concurrent first-use requests", async () => {
    const backend = new CodexCLIBackend(codexExecutable);
    const [account, models] = await Promise.all([
      backend.readAccount(),
      backend.listModels(),
    ]);
    expect(account.authenticated).toBe(true);
    expect(models).toHaveLength(2);
  });

  it("uses account status and paginated text-only model discovery", async () => {
    const backend = new CodexCLIBackend(codexExecutable);
    await expect(backend.readAccount()).resolves.toEqual({ authenticated: true });
    await expect(backend.getVersion()).resolves.toBe("9.9.9");
    const models = await backend.listModels();
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: "gpt-visible",
        isDefault: true,
        supportedReasoningEfforts: [
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
          "future_v1",
        ],
      }),
      expect.objectContaining({
        modelId: "gpt-normalized",
        supportedReasoningEfforts: ["low", "high", "xhigh"],
      }),
    ]));
    expect(models.find((model) => model.modelId === "gpt-normalized"))
      .not.toHaveProperty("defaultReasoningEffort");
  });

  it("accepts an account-less Codex mode when app-server says OpenAI auth is not required", async () => {
    vi.stubEnv("SWITCHY_FAKE_CODEX_AUTH_NOT_REQUIRED", "1");
    const backend = new CodexCLIBackend(codexExecutable);

    await expect(backend.readAccount()).resolves.toEqual({ authenticated: true });
  });

  it("streams deltas and validates structured output with usage", async () => {
    const backend = new CodexCLIBackend(codexExecutable);
    const deltas: string[] = [];
    const streamed = await backend.streamText({
      ...baseInput(),
      onDelta: (delta) => { deltas.push(delta); },
    });
    expect(streamed).toMatchObject({
      output: "streamed text",
      usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
    });
    expect(deltas.join("")).toBe("streamed text");

    const schema = z.object({ value: z.string() });
    const structured = await backend.generateStructured({
      ...baseInput(),
      jsonSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      validate: (value) => schema.parse(value),
    });
    expect(structured.output).toEqual({ value: "structured" });

    await expect(backend.generateText({
      ...baseInput(),
      prompt: "attempt-tool access",
    })).resolves.toMatchObject({ output: "streamed text" });

    await expect(backend.generateText({
      ...baseInput(),
      prompt: "same-chunk notifications",
    })).resolves.toMatchObject({
      output: "streamed text",
      usage: { totalTokens: 10 },
    });
  });

  it("passes an advertised future effort to Codex unchanged", async () => {
    const backend = new CodexCLIBackend(codexExecutable);
    await backend.listModels();

    await expect(backend.generateText({
      ...baseInput(),
      prompt: "require-max-effort",
      reasoningEffort: "max",
    })).resolves.toMatchObject({ output: "streamed text" });
  });

  it("does not terminate unrelated work when setup is cancelled", async () => {
    const backend = new CodexCLIBackend(codexExecutable);
    const active = backend.generateText({ ...baseInput(), prompt: "slow" });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const controller = new AbortController();
    const reason = new DOMException("cancelled concurrent setup", "AbortError");
    const cancelled = backend.generateText({
      ...baseInput(),
      instructions: "delay setup",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(reason), 20);

    await expect(cancelled).rejects.toBe(reason);
    await expect(active).resolves.toMatchObject({ output: "streamed text" });
  });

  it("does not apply an earlier idle deadline to active Codex work", async () => {
    const backend = new CodexCLIBackend(codexExecutable, 50);
    await backend.readAccount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(backend.generateText({
      ...baseInput(),
      prompt: "slow",
    })).resolves.toMatchObject({ output: "streamed text" });
  });

  it("interrupts a turn that acknowledges after the protocol request timed out", async () => {
    const backend = new CodexCLIBackend(codexExecutable, 5 * 60_000, 30);
    await expect(backend.generateText({
      ...baseInput(),
      prompt: "delayed-ack",
    })).rejects.toMatchObject({ type: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(backend.generateText({
      ...baseInput(),
      instructions: "require late interrupt",
    })).resolves.toMatchObject({ output: "streamed text" });
  });

  it("retires the app-server if a timed-out turn is never acknowledged safely", async () => {
    const backend = new CodexCLIBackend(codexExecutable, 5 * 60_000, 30, 50);
    await expect(backend.generateText({
      ...baseInput(),
      prompt: "very-delayed-ack",
    })).rejects.toMatchObject({ type: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await expect(backend.generateText({
      ...baseInput(),
      instructions: "require fresh process",
    })).resolves.toMatchObject({ output: "streamed text" });
  });

  it("reports unsupported Codex app-server startup as incompatible", async () => {
    vi.stubEnv("SWITCHY_FAKE_CODEX_INCOMPATIBLE", "1");
    const backend = new CodexCLIBackend(codexExecutable);
    await expect(backend.readAccount()).rejects.toMatchObject({
      type: "validation",
      message: "Codex CLI protocol is incompatible",
    });
  });

  it("reports stable-protocol parameter errors and turn authentication failures safely", async () => {
    vi.stubEnv("SWITCHY_FAKE_CODEX_INVALID_PARAMS", "1");
    await expect(new CodexCLIBackend(codexExecutable).generateText(baseInput()))
      .rejects.toMatchObject({
        type: "validation",
        message: "Codex CLI request parameters are incompatible",
      });
    vi.unstubAllEnvs();

    await expect(new CodexCLIBackend(codexExecutable).generateText({
      ...baseInput(),
      prompt: "turn-auth-failure",
    })).rejects.toMatchObject({
      type: "missing_api_key",
      message: "Codex CLI authentication is unavailable",
    });
  });

  it("preserves Codex startup crashes and initialization timeouts as transient failures", async () => {
    vi.stubEnv("SWITCHY_FAKE_CODEX_STARTUP_CRASH", "1");
    await expect(new CodexCLIBackend(codexExecutable).readAccount()).rejects.toMatchObject({
      type: "network",
    });
    vi.unstubAllEnvs();

    vi.stubEnv("SWITCHY_FAKE_CODEX_HANG_INITIALIZE", "1");
    const hanging = new CodexCLIBackend(codexExecutable, 5 * 60_000, 30, 50, 30);
    await expect(hanging.readAccount()).rejects.toMatchObject({ type: "timeout" });
  });

  it("interrupts cancellation, rejects malformed output, and reports process crashes safely", async () => {
    const backend = new CodexCLIBackend(codexExecutable);
    const controller = new AbortController();
    const reason = new DOMException("cancelled by test", "AbortError");
    const pending = backend.generateText({
      ...baseInput(),
      prompt: "slow",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(reason), 20);
    await expect(pending).rejects.toBe(reason);

    const setupController = new AbortController();
    const setupReason = new DOMException("cancelled during setup", "AbortError");
    const setup = backend.generateText({
      ...baseInput(),
      instructions: "delay setup",
      signal: setupController.signal,
    });
    setTimeout(() => setupController.abort(setupReason), 20);
    await expect(setup).rejects.toBe(setupReason);

    await expect(backend.generateText(baseInput())).resolves.toMatchObject({
      output: "streamed text",
    });

    await expect(backend.generateStructured({
      ...baseInput(),
      prompt: "malformed",
      jsonSchema: { type: "object" },
      validate: (value) => value,
    })).rejects.toThrow("malformed JSON");

    const crashingBackend = new CodexCLIBackend(codexExecutable);
    await expect(crashingBackend.generateText({
      ...baseInput(),
      prompt: "crash",
    })).rejects.toThrow("process stopped unexpectedly");
  });
});

describe("OpenCode CLI backend", () => {
  it("reports unsupported OpenCode server startup as incompatible", async () => {
    vi.stubEnv("SWITCHY_FAKE_OPENCODE_INCOMPATIBLE", "1");
    const backend = new OpenCodeCLIBackend(openCodeExecutable, async () => openCodeSDK);
    await expect(backend.getVersion()).rejects.toMatchObject({
      type: "validation",
      message: "OpenCode CLI protocol is incompatible",
    });
  });

  it("distinguishes transient OpenCode crashes from a confirmed missing protocol", async () => {
    vi.stubEnv("SWITCHY_FAKE_OPENCODE_STARTUP_CRASH", "1");
    const crashed = new OpenCodeCLIBackend(openCodeExecutable, async () => openCodeSDK);
    await expect(crashed.getVersion()).rejects.toMatchObject({ type: "network" });
    vi.unstubAllEnvs();

    vi.stubEnv("SWITCHY_FAKE_OPENCODE_MISSING_HEALTH", "1");
    const incompatible = new OpenCodeCLIBackend(openCodeExecutable, async () => openCodeSDK);
    await expect(incompatible.getVersion()).rejects.toMatchObject({
      type: "validation",
      message: "OpenCode CLI protocol is incompatible",
    });
  });

  it("exposes models only from connected OpenCode providers", async () => {
    vi.stubEnv("SWITCHY_FAKE_OPENCODE_DISCONNECTED", "1");
    const backend = new OpenCodeCLIBackend(openCodeExecutable, async () => openCodeSDK);
    await expect(backend.listModels()).resolves.toEqual([]);
    expect(backend.hasConnectedProviders()).toBe(false);
    backend.retire();
  });

  it("groups usable text models and executes isolated streaming and structured sessions", async () => {
    const backend = new OpenCodeCLIBackend(
      openCodeExecutable,
      async () => openCodeSDK
    );
    await expect(backend.getVersion()).resolves.toBe("8.8.8");
    const models = await backend.listModels();
    expect(models).toEqual([
      expect.objectContaining({
        modelId: "openai/text",
        group: "OpenCode · OpenAI",
        upstreamProvider: "openai",
      }),
    ]);

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "require-max-effort",
      reasoningEffort: "max",
    })).resolves.toMatchObject({ output: "hello" });

    const deltas: string[] = [];
    const streamed = await backend.streamText({
      ...baseInput(),
      modelId: "openai/text",
      onDelta: async (delta) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        deltas.push(delta);
      },
    });
    expect(streamed).toMatchObject({
      output: "hello",
      usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
    });
    expect(deltas.join("")).toBe("hello");

    const structured = await backend.generateStructured({
      ...baseInput(),
      modelId: "openai/text",
      jsonSchema: { type: "object", properties: { value: { type: "string" } } },
      validate: (value) => z.object({ value: z.string() }).parse(value),
    });
    expect(structured.output).toEqual({ value: "structured" });

    const controller = new AbortController();
    const reason = new DOMException("cancelled by test", "AbortError");
    const pending = backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "slow",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(reason), 20);
    await expect(pending).rejects.toBe(reason);

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "rate-limit",
    })).rejects.toMatchObject({ type: "rate_limit", retryAfterMs: 1_000 });

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "missing-model",
    })).rejects.toMatchObject({ type: "invalid_model" });

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "close-event-stream",
    })).rejects.toMatchObject({
      type: "network",
      message: "OpenCode event stream ended before session completion",
    });

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "embedded-auth-error",
    })).rejects.toMatchObject({ type: "missing_api_key" });

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "embedded-rate-limit",
    })).rejects.toMatchObject({ type: "rate_limit", retryAfterMs: 2_000 });

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "embedded-abort",
    })).rejects.toMatchObject({ type: "generation_failed" });

    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "embedded-length",
    })).rejects.toThrow("model limits");

    await expect(backend.generateStructured({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "embedded-structured",
      jsonSchema: { type: "object" },
      validate: (value) => value,
    })).rejects.toMatchObject({ type: "no_object" });
  });

  it("omits an unadvertised reasoning variant when the catalog is not loaded", async () => {
    const backend = new OpenCodeCLIBackend(
      openCodeExecutable,
      async () => openCodeSDK
    );
    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "unknown-support",
    })).resolves.toMatchObject({ output: "hello" });
  });

  it("does not apply an earlier idle deadline to active OpenCode work", async () => {
    const backend = new OpenCodeCLIBackend(
      openCodeExecutable,
      async () => openCodeSDK,
      50
    );
    await backend.getVersion();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(backend.generateText({
      ...baseInput(),
      modelId: "openai/text",
      prompt: "medium-delay",
    })).resolves.toMatchObject({ output: "hello" });
  });

  it("rejects bounded output policies that the CLI protocols cannot enforce", async () => {
    const codex = new CodexCLIBackend(codexExecutable);
    await expect(codex.generateText({
      ...baseInput(),
      maxOutputTokens: 100,
    })).rejects.toThrow("output-token limit");

    const openCode = new OpenCodeCLIBackend(openCodeExecutable, async () => openCodeSDK);
    await expect(openCode.generateText({
      ...baseInput(),
      modelId: "openai/text",
      maxOutputTokens: 100,
    })).rejects.toThrow("output-token limit");
  });
});
