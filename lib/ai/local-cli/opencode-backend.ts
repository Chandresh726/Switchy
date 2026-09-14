import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ModelInfo as OpenCodeModel,
  OpenCodeClient,
  SessionMessageAssistant,
  V2Event as OpenCodeEvent,
} from "@opencode/client";

import { CLI_IDLE_SHUTDOWN_MS } from "@/lib/ai/local-cli/constants";
import type {
  AIGenerationBackend,
  BackendResult,
  BackendStreamingInput,
  BackendStructuredInput,
  BackendTextInput,
} from "@/lib/ai/local-cli/types";
import type { ProviderModelDefinition } from "@/lib/ai/providers/model-catalog";
import {
  createEffortReasoningControl,
  withReasoningControl,
} from "@/lib/ai/providers/reasoning-controls";
import { isReasoningEffort } from "@/lib/ai/providers/types";
import { AIError, AIRateLimitError } from "@/lib/ai/shared/errors";

const DENY_ALL_PERMISSIONS = [
  { action: "*", resource: "*", effect: "deny" as const },
];

type OpenCodeClientModule = typeof import("@opencode/client");
export type OpenCodeClientLoader = () => Promise<OpenCodeClientModule>;
let clientModulePromise: Promise<OpenCodeClientModule> | undefined;

function loadOpenCodeClient(): Promise<OpenCodeClientModule> {
  clientModulePromise ??= import("@opencode/client");
  return clientModulePromise;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function parseModelId(modelId: string): { providerID: string; modelID: string } {
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator === modelId.length - 1) {
    throw new AIError({
      type: "invalid_model",
      message: `OpenCode model "${modelId}" is invalid`,
    });
  }
  return { providerID: modelId.slice(0, separator), modelID: modelId.slice(separator + 1) };
}

function isUsableTextModel(model: OpenCodeModel): boolean {
  return model.enabled
    && model.status !== "deprecated"
    && model.capabilities.input.includes("text")
    && model.capabilities.output.includes("text");
}

function hasOpenCodeErrorTag(error: unknown, tag: string): boolean {
  return Boolean(error && typeof error === "object" && "_tag" in error
    && (error as { _tag?: unknown })._tag === tag);
}

function getOpenCodeClientErrorReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("reason" in error)) return undefined;
  const reason = (error as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("OpenCode execution cancelled", "AbortError");
}

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function mapOpenCodeError(error: unknown): AIError {
  if (hasOpenCodeErrorTag(error, "UnauthorizedError")) {
    return new AIError({
      type: "missing_api_key",
      message: "OpenCode authentication is unavailable",
      retryable: false,
    });
  }
  if (hasOpenCodeErrorTag(error, "ProviderNotFoundError")) {
    return new AIError({
      type: "invalid_model",
      message: "The configured OpenCode model is unavailable",
      retryable: false,
    });
  }
  if (hasOpenCodeErrorTag(error, "ServiceUnavailableError")) {
    return new AIError({
      type: "network",
      message: "OpenCode provider service is unavailable",
      retryable: true,
    });
  }
  const clientErrorReason = getOpenCodeClientErrorReason(error);
  if (clientErrorReason) {
    return new AIError({
      type: "network",
      message: "OpenCode CLI protocol request failed",
      retryable: clientErrorReason === "Transport",
      cause: error instanceof Error ? error : undefined,
    });
  }

  const record = error && typeof error === "object"
    ? error as { name?: unknown; type?: unknown; message?: unknown; status?: unknown; data?: unknown }
    : {};
  const name = typeof record.name === "string"
    ? record.name
    : typeof record.type === "string" ? record.type : "UnknownError";
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : {};
  const statusCode = typeof record.status === "number"
    ? record.status
    : typeof data.statusCode === "number" ? data.statusCode : undefined;

  if (/auth|credential|unauthorized/i.test(name) || statusCode === 401 || statusCode === 403) {
    return new AIError({
      type: "missing_api_key",
      message: "OpenCode authentication is unavailable for the configured model",
      retryable: false,
    });
  }
  if (statusCode === 429 || /rate.?limit/i.test(name)) {
    return new AIRateLimitError("OpenCode provider rate limit was reached");
  }
  if (/invalid.?model|model.?not.?found/i.test(name)) {
    return new AIError({
      type: "invalid_model",
      message: "The configured OpenCode model is unavailable",
      retryable: false,
    });
  }
  if (name === "APIError") {
    return new AIError({
      type: "generation_failed",
      message: "OpenCode provider request failed",
      retryable: data.isRetryable === true,
    });
  }
  if (/abort|interrupt/i.test(name)) {
    return new AIError({
      type: "generation_failed",
      message: "OpenCode generation was aborted",
      retryable: true,
    });
  }
  if (/structured.?output/i.test(name)) {
    return new AIError({
      type: "no_object",
      message: "OpenCode returned invalid structured output",
      retryable: false,
    });
  }
  if (/length|context.?overflow/i.test(name)) {
    return new AIError({
      type: "generation_failed",
      message: "OpenCode could not complete the response within the model limits",
      retryable: false,
    });
  }
  if (/content.?filter/i.test(name)) {
    return new AIError({
      type: "generation_failed",
      message: "OpenCode could not generate this response",
      retryable: false,
    });
  }
  return new AIError({
    type: "generation_failed",
    message: "OpenCode generation failed",
    retryable: false,
  });
}

async function waitForEventSubscription(
  ready: Promise<void>,
  signal: AbortSignal
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AIError({
      type: "network",
      message: "OpenCode event stream did not become ready",
      retryable: true,
    })), 5_000);
  });
  try {
    await raceWithSignal(Promise.race([ready, timeout]), signal);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OpenCodeCLIBackend implements AIGenerationBackend {
  private process: ChildProcess | null = null;
  private client: OpenCodeClient | null = null;
  private startPromise: Promise<OpenCodeClient> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private version?: string;
  private readonly reasoningEffortsByModel = new Map<string, string[]>();
  private connectedProviderIds = new Set<string>();
  private activeOperations = 0;
  private retireWhenIdle = false;

  constructor(
    private readonly executable: string,
    private readonly loadClient: OpenCodeClientLoader = loadOpenCodeClient,
    private readonly idleShutdownMs = CLI_IDLE_SHUTDOWN_MS
  ) {}

  retire(): void {
    this.retireWhenIdle = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.activeOperations === 0) this.stopProcess();
  }

  async listModels(): Promise<ProviderModelDefinition[]> {
    this.beginOperation();
    try {
      const client = await this.start();
      const [catalog, providerCatalog, defaultModel] = await Promise.all([
        client.model.list(undefined, { signal: AbortSignal.timeout(10_000) }),
        client.provider.list(undefined, { signal: AbortSignal.timeout(10_000) }),
        client.model.default(undefined, { signal: AbortSignal.timeout(10_000) }),
      ]);
      const providerNames = new Map(
        providerCatalog.data.map((provider) => [provider.id, provider.name])
      );
      const models = catalog.data.filter(isUsableTextModel);
      this.connectedProviderIds = new Set(models.map((model) => model.providerID));

      return models.map((model) => {
        const reasoningControl = createEffortReasoningControl(
          model.variants
            .map(({ id }) => id)
            .filter(isReasoningEffort)
            .map((value) => ({ value }))
        );
        const variants = reasoningControl.kind === "effort"
          ? reasoningControl.options.map(({ value }) => value)
          : [];
        const modelId = `${model.providerID}/${model.modelID}`;
        this.reasoningEffortsByModel.set(modelId, variants);
        return withReasoningControl({
          modelId,
          label: model.name || model.modelID,
          description: model.family ?? "",
          group: `OpenCode · ${providerNames.get(model.providerID) ?? model.providerID}`,
          upstreamProvider: model.providerID,
          isDefault: defaultModel.data?.providerID === model.providerID
            && defaultModel.data.modelID === model.modelID,
        }, reasoningControl);
      });
    } catch (error) {
      throw mapOpenCodeError(error);
    } finally {
      this.endOperation();
    }
  }

  setModelReasoningEfforts(modelId: string, efforts: string[]): void {
    this.reasoningEffortsByModel.set(modelId, [...efforts]);
  }

  hasConnectedProviders(): boolean {
    return this.connectedProviderIds.size > 0;
  }

  getLastConnectedProviderIds(): string[] {
    return Array.from(this.connectedProviderIds);
  }

  async readConnectedProviderIds(): Promise<string[]> {
    this.beginOperation();
    try {
      const client = await this.start();
      const catalog = await client.model.list(
        undefined,
        { signal: AbortSignal.timeout(10_000) }
      );
      this.connectedProviderIds = new Set(
        catalog.data.filter(isUsableTextModel).map((model) => model.providerID)
      );
      return this.getLastConnectedProviderIds();
    } catch (error) {
      throw mapOpenCodeError(error);
    } finally {
      this.endOperation();
    }
  }

  async getVersion(): Promise<string | undefined> {
    this.beginOperation();
    try {
      await this.start();
      return this.version;
    } finally {
      this.endOperation();
    }
  }

  async generateText(input: BackendTextInput): Promise<BackendResult<string>> {
    const result = await this.runSession(input);
    if (typeof result.output !== "string") {
      throw new AIError({ type: "generation_failed", message: "OpenCode returned invalid text output" });
    }
    return { ...result, output: result.output };
  }

  async streamText(input: BackendStreamingInput): Promise<BackendResult<string>> {
    const result = await this.runSession(input, input.onDelta);
    if (typeof result.output !== "string") {
      throw new AIError({ type: "generation_failed", message: "OpenCode returned invalid text output" });
    }
    return { ...result, output: result.output };
  }

  async generateStructured<T>(
    input: BackendStructuredInput<T>
  ): Promise<BackendResult<T>> {
    const result = await this.runSession({
      ...input,
      instructions: `${input.instructions}\n\nJSON SCHEMA:\n${JSON.stringify(input.jsonSchema)}`,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.output);
    } catch (error) {
      throw new AIError({
        type: "json_parse",
        message: "OpenCode returned malformed JSON",
        cause: error instanceof Error ? error : undefined,
      });
    }
    return { ...result, output: input.validate(parsed) };
  }

  private async runSession(
    input: BackendTextInput,
    onDelta?: (delta: string) => void | Promise<void>
  ): Promise<BackendResult<string>> {
    input.signal.throwIfAborted();
    if (input.maxOutputTokens !== undefined) {
      throw new AIError({
        type: "validation",
        message: "OpenCode does not expose an enforceable per-session output-token limit",
        retryable: false,
      });
    }
    this.beginOperation();
    let client: OpenCodeClient;
    let directory: string;
    try {
      client = await raceWithSignal(this.start(), input.signal);
      directory = await mkdtemp(path.join(tmpdir(), "switchy-opencode-"));
    } catch (error) {
      this.endOperation();
      throw error;
    }
    let sessionID: string | undefined;
    let subscription: AsyncIterable<OpenCodeEvent> | undefined;
    let subscriptionIterator: AsyncIterator<OpenCodeEvent> | undefined;
    const eventController = new AbortController();
    let eventPump: Promise<void> | undefined;
    let removeAbortListener: (() => void) | undefined;

    try {
      const model = parseModelId(input.modelId);
      const knownReasoningEfforts = this.reasoningEffortsByModel.get(input.modelId);
      if (input.reasoningEffort && knownReasoningEfforts && knownReasoningEfforts.length > 0
          && !knownReasoningEfforts.includes(input.reasoningEffort)) {
        throw new AIError({
          type: "reasoning_not_supported",
          message: "The selected reasoning effort is unavailable for this OpenCode model",
          retryable: false,
        });
      }
      const variant = input.reasoningEffort
        && knownReasoningEfforts?.includes(input.reasoningEffort)
        ? input.reasoningEffort
        : undefined;
      const created = await client.session.create(
        {
          title: "Switchy AI execution",
          agent: "switchy",
          model: {
            id: model.modelID,
            providerID: model.providerID,
            variant,
          },
          location: { directory },
          permissions: DENY_ALL_PERMISSIONS,
        },
        { signal: input.signal }
      );
      sessionID = created.id;

      await client.session.instructions.entry.put(
        { sessionID, key: "switchy", value: input.instructions },
        { signal: input.signal }
      );

      const onAbort = () => {
        if (sessionID) void client.session.interrupt(
          { sessionID, continue: false },
          { signal: AbortSignal.timeout(2_000) }
        ).catch(() => undefined);
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => input.signal.removeEventListener("abort", onAbort);
      if (input.signal.aborted) onAbort();

      subscription = client.event.subscribe({
        signal: AbortSignal.any([eventController.signal, input.signal]),
      });
      subscriptionIterator = subscription[Symbol.asyncIterator]();
      let streamedOutput = "";
      let eventError: Error | undefined;
      let markReady!: () => void;
      let rejectReady!: (error: Error) => void;
      let completeSession!: () => void;
      const subscriptionReady = new Promise<void>((resolve, reject) => {
        markReady = resolve;
        rejectReady = reject;
      });
      let terminalEventReceived = false;
      const sessionCompleted = new Promise<void>((resolve) => {
        completeSession = resolve;
      });
      let deltaDelivery = Promise.resolve();
      eventPump = (async () => {
        while (true) {
          const next = await subscriptionIterator!.next();
          if (next.done) break;
          const event = next.value;
          if (event.type === "server.connected") {
            markReady();
            continue;
          }
          if (event.type === "session.text.delta") {
            if (event.data.sessionID !== sessionID) continue;
            streamedOutput += event.data.delta;
            deltaDelivery = deltaDelivery.then(() => onDelta?.(event.data.delta));
          }
          if (event.type === "session.execution.failed") {
            if (event.data.sessionID !== sessionID) continue;
            eventError = mapOpenCodeError(event.data.error);
            terminalEventReceived = true;
            completeSession();
          }
          if (event.type === "session.execution.interrupted") {
            if (event.data.sessionID !== sessionID) continue;
            eventError = new AIError({
              type: "generation_failed",
              message: "OpenCode generation was interrupted",
              retryable: true,
            });
            terminalEventReceived = true;
            completeSession();
          }
          if (event.type === "session.execution.succeeded") {
            if (event.data.sessionID !== sessionID) continue;
            terminalEventReceived = true;
            completeSession();
          }
        }
        if (!terminalEventReceived && !input.signal.aborted && !eventController.signal.aborted) {
          eventError = new AIError({
            type: "network",
            message: "OpenCode event stream ended before session completion",
          });
          completeSession();
        }
      })().catch((error) => {
        if (!input.signal.aborted && !eventController.signal.aborted) {
          eventError = mapOpenCodeError(error);
          rejectReady(eventError);
          completeSession();
        }
      });

      try {
        await waitForEventSubscription(subscriptionReady, input.signal);
        await client.session.prompt(
          { sessionID, text: input.prompt },
          { signal: input.signal }
        );
        input.signal.throwIfAborted();

        await raceWithSignal(sessionCompleted, input.signal);
        await raceWithSignal(deltaDelivery, input.signal);
        if (eventError) throw eventError;

        const context = await client.session.context(
          { sessionID },
          { signal: input.signal }
        );
        const response = context.findLast(
          (message): message is SessionMessageAssistant => message.type === "assistant"
        );
        if (!response) {
          throw new AIError({
            type: "generation_failed",
            message: "OpenCode completed without an assistant response",
          });
        }
        if (response.error) throw mapOpenCodeError(response.error);

        const output = response.content
          .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("") || streamedOutput;
        const tokens = response.tokens;
        const outputTokens = tokens ? tokens.output + tokens.reasoning : undefined;

        return {
          output,
          usage: {
            inputTokens: tokens?.input,
            inputNoCacheTokens: tokens
              ? Math.max(0, tokens.input - tokens.cache.read)
              : undefined,
            inputCacheReadTokens: tokens?.cache.read,
            inputCacheWriteTokens: tokens?.cache.write,
            outputTokens,
            outputTextTokens: tokens?.output,
            outputReasoningTokens: tokens?.reasoning,
            totalTokens: tokens
              ? tokens.input + tokens.output + tokens.reasoning
              : undefined,
          },
          finishReason: response.finish,
          providerRequestId: sessionID,
          warningCodes: [],
        };
      } catch (error) {
        if (error instanceof AIError || input.signal.aborted) throw error;
        throw mapOpenCodeError(error);
      } finally {
        removeAbortListener?.();
      }
    } finally {
      removeAbortListener?.();
      if (sessionID) {
        await client.session.interrupt(
          { sessionID, continue: false },
          { signal: AbortSignal.timeout(2_000) }
        ).catch(() => undefined);
        await client.session.remove(
          { sessionID },
          { signal: AbortSignal.timeout(2_000) }
        ).catch(() => undefined);
      }
      eventController.abort();
      if (subscriptionIterator) {
        await Promise.race([
          Promise.resolve(subscriptionIterator.return?.()).then(() => undefined).catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
      if (eventPump) {
        await Promise.race([
          eventPump,
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
      await rm(directory, { recursive: true, force: true });
      this.endOperation();
    }
  }

  private async start(): Promise<OpenCodeClient> {
    if (this.client) return this.client;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<OpenCodeClient> {
    const port = await reservePort();
    const password = randomBytes(24).toString("base64url");
    const username = "opencode";
    const child = spawn(
      this.executable,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            share: "disabled",
            update: "disable",
            snapshots: false,
            formatter: false,
            lsp: false,
            plugins: [],
            instructions: [],
            mcp: { servers: {} },
            permissions: DENY_ALL_PERMISSIONS,
            default_agent: "switchy",
            agents: {
              switchy: {
                description: "Isolated Switchy text generation",
                mode: "primary",
                system: "Follow only the session instructions supplied by Switchy. Never use tools or external context.",
                permissions: DENY_ALL_PERMISSIONS,
              },
            },
          }),
        },
      }
    );
    this.process = child;
    let processError: Error | undefined;
    let unsupportedStartupOptions = false;
    child.once("error", (error) => {
      processError = error;
      if (this.process === child) {
        this.process = null;
        this.client = null;
      }
    });
    child.once("exit", () => {
      if (this.process === child) {
        this.process = null;
        this.client = null;
      }
    });
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8", 0, 1_024).toLowerCase();
      if (/unknown (?:flag|option|argument)|unrecognized (?:flag|option|argument)|unsupported .*(?:flag|option)|unexpected argument/.test(message)) {
        unsupportedStartupOptions = true;
      }
    });

    try {
      const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const { OpenCode } = await this.loadClient();
      const client = OpenCode.make({
        baseUrl: `http://127.0.0.1:${port}`,
        headers: { Authorization: authorization },
      });

      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (processError || child.exitCode !== null) break;
        try {
          const health = await client.health.get({
            signal: AbortSignal.timeout(1_000),
          });
          if (health.healthy) {
            this.version = health.version;
            this.client = client;
            this.scheduleIdleShutdown();
            return client;
          }
        } catch (error) {
          if (hasOpenCodeErrorTag(error, "UnauthorizedError")) {
            throw new AIError({
              type: "validation",
              message: "OpenCode CLI protocol authentication is incompatible",
              retryable: false,
            });
          }
          const clientErrorReason = getOpenCodeClientErrorReason(error);
          if (clientErrorReason === "UnexpectedStatus"
              || clientErrorReason === "UnsupportedContentType") {
            throw new AIError({
              type: "validation",
              message: "OpenCode CLI protocol is incompatible",
              retryable: false,
            });
          }
          if (error instanceof AIError) throw error;
          // The process may still be starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!processError && child.exitCode !== null && unsupportedStartupOptions) {
        throw new AIError({
          type: "validation",
          message: "OpenCode CLI protocol is incompatible",
          retryable: false,
        });
      }
      throw new AIError({
        type: "network",
        message: "OpenCode server did not become ready",
        cause: processError,
      });
    } catch (error) {
      child.kill("SIGTERM");
      if (this.process === child) this.process = null;
      this.client = null;
      throw error;
    }
  }

  private beginOperation(): void {
    this.activeOperations += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private endOperation(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    if (this.activeOperations === 0 && this.retireWhenIdle) {
      this.stopProcess();
      return;
    }
    this.scheduleIdleShutdown();
  }

  private scheduleIdleShutdown(): void {
    if (this.activeOperations > 0 || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.stopProcess();
    }, this.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  private stopProcess(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.process?.kill("SIGTERM");
    this.process = null;
    this.client = null;
    this.retireWhenIdle = false;
  }
}
