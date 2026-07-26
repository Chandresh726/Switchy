import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { OpencodeClient } from "@opencode-ai/sdk/v2";

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
  { permission: "*", pattern: "*", action: "deny" as const },
];

type OpenCodeSDK = typeof import("@opencode-ai/sdk/v2");
export type OpenCodeSDKLoader = () => Promise<OpenCodeSDK>;
let sdkPromise: Promise<OpenCodeSDK> | undefined;

function loadOpenCodeSDK(): Promise<OpenCodeSDK> {
  sdkPromise ??= import("@opencode-ai/sdk/v2");
  return sdkPromise;
}

const DISABLED_TOOLS = {
  bash: false,
  read: false,
  write: false,
  edit: false,
  glob: false,
  grep: false,
  webfetch: false,
  websearch: false,
  task: false,
  skill: false,
  question: false,
};

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

function unwrap<T>(
  response: { data?: T; error?: unknown; response?: Response },
  message: string
): T {
  if (response.data !== undefined) return response.data;
  const status = response.response?.status;
  if (status === 429) {
    const retryAfter = Number(response.response?.headers.get("retry-after"));
    throw new AIRateLimitError(
      "OpenCode provider rate limit was reached",
      undefined,
      Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined
    );
  }
  if (status === 401 || status === 403) {
    throw new AIError({
      type: "missing_api_key",
      message: "OpenCode authentication is unavailable",
      retryable: false,
    });
  }
  if (status === 404) {
    throw new AIError({
      type: "validation",
      message: "OpenCode CLI protocol is incompatible",
      retryable: false,
    });
  }
  if (status === 400 && message.includes("generation")) {
    throw new AIError({
      type: "invalid_model",
      message: "The configured OpenCode model is unavailable",
      retryable: false,
    });
  }
  throw new AIError({ type: "generation_failed", message, retryable: false });
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

function parseRetryDelay(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLocaleLowerCase("en-US"), value])
  );
  const milliseconds = Number.parseFloat(normalized.get("retry-after-ms") ?? "");
  if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
  const value = normalized.get("retry-after");
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function mapAssistantError(error: unknown): AIError {
  const record = error && typeof error === "object"
    ? error as { name?: unknown; data?: unknown }
    : {};
  const name = typeof record.name === "string" ? record.name : "UnknownError";
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : {};

  if (name === "ProviderAuthError") {
    return new AIError({
      type: "missing_api_key",
      message: "OpenCode authentication is unavailable for the configured model",
      retryable: false,
    });
  }
  if (name === "APIError") {
    const statusCode = typeof data.statusCode === "number" ? data.statusCode : undefined;
    if (statusCode === 429) {
      return new AIRateLimitError(
        "OpenCode provider rate limit was reached",
        undefined,
        parseRetryDelay(
          data.responseHeaders && typeof data.responseHeaders === "object"
            ? data.responseHeaders as Record<string, string>
            : undefined
        )
      );
    }
    if (statusCode === 401 || statusCode === 403) {
      return new AIError({
        type: "missing_api_key",
        message: "OpenCode authentication is unavailable for the configured model",
        retryable: false,
      });
    }
    return new AIError({
      type: "generation_failed",
      message: "OpenCode provider request failed",
      retryable: data.isRetryable === true,
    });
  }
  if (name === "MessageAbortedError") {
    return new AIError({
      type: "generation_failed",
      message: "OpenCode generation was aborted",
      retryable: true,
    });
  }
  if (name === "StructuredOutputError") {
    return new AIError({
      type: "no_object",
      message: "OpenCode returned invalid structured output",
      retryable: false,
    });
  }
  if (name === "MessageOutputLengthError" || name === "ContextOverflowError") {
    return new AIError({
      type: "generation_failed",
      message: "OpenCode could not complete the response within the model limits",
      retryable: false,
    });
  }
  if (name === "ContentFilterError") {
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

export class OpenCodeCLIBackend implements AIGenerationBackend {
  private process: ChildProcess | null = null;
  private client: OpencodeClient | null = null;
  private startPromise: Promise<OpencodeClient> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private version?: string;
  private readonly reasoningEffortsByModel = new Map<string, string[]>();
  private connectedProviderIds = new Set<string>();
  private activeOperations = 0;
  private retireWhenIdle = false;

  constructor(
    private readonly executable: string,
    private readonly loadSDK: OpenCodeSDKLoader = loadOpenCodeSDK,
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
      const [catalogResponse, providerResponse] = await Promise.all([
        client.config.providers(undefined, { signal: AbortSignal.timeout(10_000) }),
        client.provider.list(undefined, { signal: AbortSignal.timeout(10_000) }),
      ]);
      const catalog = unwrap(catalogResponse, "OpenCode model discovery failed");
      const providerState = unwrap(providerResponse, "OpenCode provider discovery failed");
      const connectedProviders = new Set(providerState.connected);
      this.connectedProviderIds = connectedProviders;

      return catalog.providers.filter((provider) => connectedProviders.has(provider.id)).flatMap((provider) =>
      Object.values(provider.models)
        .filter(
          (model) =>
            model.capabilities.input.text &&
            model.capabilities.output.text &&
            model.status !== "deprecated"
        )
        .map((model) => {
          const reasoningControl = createEffortReasoningControl(
            Object.keys(model.variants ?? {})
              .filter(isReasoningEffort)
              .map((value) => ({ value }))
          );
          const variants = reasoningControl.kind === "effort"
            ? reasoningControl.options.map(({ value }) => value)
            : [];
          const modelId = `${provider.id}/${model.id}`;
          this.reasoningEffortsByModel.set(modelId, variants);
          return withReasoningControl({
            modelId,
            label: model.name || model.id,
            description: model.family ?? "",
            group: `OpenCode · ${provider.name}`,
            upstreamProvider: provider.id,
            isDefault: catalog.default[provider.id] === model.id,
          }, reasoningControl);
        })
      );
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
      const response = await client.provider.list(
        undefined,
        { signal: AbortSignal.timeout(10_000) }
      );
      const providerState = unwrap(response, "OpenCode provider discovery failed");
      this.connectedProviderIds = new Set(providerState.connected);
      return this.getLastConnectedProviderIds();
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
    const result = await this.runSession(input, undefined, input.onDelta);
    if (typeof result.output !== "string") {
      throw new AIError({ type: "generation_failed", message: "OpenCode returned invalid text output" });
    }
    return { ...result, output: result.output };
  }

  async generateStructured<T>(
    input: BackendStructuredInput<T>
  ): Promise<BackendResult<T>> {
    const result = await this.runSession(input, input.jsonSchema);
    return { ...result, output: input.validate(result.output) };
  }

  private async runSession(
    input: BackendTextInput,
    jsonSchema?: Record<string, unknown>,
    onDelta?: (delta: string) => void | Promise<void>
  ): Promise<BackendResult<unknown>> {
    input.signal.throwIfAborted();
    if (input.maxOutputTokens !== undefined) {
      throw new AIError({
        type: "validation",
        message: "OpenCode does not expose an enforceable per-session output-token limit",
        retryable: false,
      });
    }
    this.beginOperation();
    let client: OpencodeClient;
    let directory: string;
    try {
      client = await raceWithSignal(this.start(), input.signal);
      directory = await mkdtemp(path.join(tmpdir(), "switchy-opencode-"));
    } catch (error) {
      this.endOperation();
      throw error;
    }
    let sessionID: string | undefined;
    let subscription: Awaited<ReturnType<OpencodeClient["event"]["subscribe"]>> | undefined;
    const eventController = new AbortController();
    let eventPump: Promise<void> | undefined;
    let removeAbortListener: (() => void) | undefined;

    try {
      const model = parseModelId(input.modelId);
      const created = await client.session.create(
        {
          directory,
          title: "Switchy AI execution",
          agent: "switchy",
          model: { id: model.modelID, providerID: model.providerID },
          permission: DENY_ALL_PERMISSIONS,
        },
        { signal: input.signal }
      );
      sessionID = unwrap(created, "OpenCode session creation failed").id;

      const onAbort = () => {
        if (sessionID) void client.session.abort(
          { sessionID, directory },
          { signal: AbortSignal.timeout(2_000) }
        ).catch(() => undefined);
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => input.signal.removeEventListener("abort", onAbort);
      if (input.signal.aborted) onAbort();

      subscription = await client.event.subscribe(
        { directory },
        { signal: AbortSignal.any([eventController.signal, input.signal]) }
      );
      let streamedOutput = "";
      let eventError: Error | undefined;
      let completeSession!: () => void;
      let terminalEventReceived = false;
      const sessionCompleted = new Promise<void>((resolve) => {
        completeSession = resolve;
      });
      let deltaDelivery = Promise.resolve();
      eventPump = (async () => {
        for await (const rawEvent of subscription!.stream) {
          const event = rawEvent as unknown as Record<string, unknown>;
          const properties = (event.properties ?? event.data) as Record<string, unknown> | undefined;
          if (properties?.sessionID !== sessionID) continue;
          if (event.type === "message.part.delta" && properties.field === "text" && typeof properties.delta === "string") {
            streamedOutput += properties.delta;
            deltaDelivery = deltaDelivery.then(() => onDelta?.(properties.delta as string));
          }
          if (event.type === "session.error") {
            eventError = mapAssistantError(properties.error);
            terminalEventReceived = true;
            completeSession();
          }
          if (event.type === "session.idle") {
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
          eventError = error instanceof Error
            ? error
            : new AIError({ type: "network", message: "OpenCode event stream failed" });
          completeSession();
        }
      });

      const knownReasoningEfforts = this.reasoningEffortsByModel.get(input.modelId);
      if (input.reasoningEffort && knownReasoningEfforts && knownReasoningEfforts.length > 0 &&
          !knownReasoningEfforts.includes(input.reasoningEffort)) {
        throw new AIError({
          type: "reasoning_not_supported",
          message: "The selected reasoning effort is unavailable for this OpenCode model",
          retryable: false,
        });
      }
      try {
        const prompted = await client.session.prompt(
          {
            sessionID,
            directory,
            model,
            agent: "switchy",
            system: input.instructions,
            variant: input.reasoningEffort && knownReasoningEfforts?.includes(input.reasoningEffort)
              ? input.reasoningEffort
              : undefined,
            tools: DISABLED_TOOLS,
            format: jsonSchema
              ? { type: "json_schema", schema: jsonSchema, retryCount: 0 }
              : { type: "text" },
            parts: [{ type: "text", text: input.prompt }],
          },
          { signal: input.signal }
        );
        input.signal.throwIfAborted();
        const response = unwrap(prompted, "OpenCode generation failed");
        if (response.info.error) throw mapAssistantError(response.info.error);

        await raceWithSignal(sessionCompleted, input.signal);
        await raceWithSignal(deltaDelivery, input.signal);
        if (eventError) throw eventError;

        const output = jsonSchema
          ? response.info.structured
          : response.parts
              .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join("") || streamedOutput;

        return {
          output: output ?? "",
          usage: {
            inputTokens: response.info.tokens.input,
            outputTokens: response.info.tokens.output,
            totalTokens: response.info.tokens.total,
          },
          finishReason: response.info.finish,
          warningCodes: [],
        };
      } finally {
        removeAbortListener?.();
      }
    } finally {
      removeAbortListener?.();
      if (sessionID) {
        await client.session.abort(
          { sessionID, directory },
          { signal: AbortSignal.timeout(2_000) }
        ).catch(() => undefined);
        await client.session.delete(
          { sessionID, directory },
          { signal: AbortSignal.timeout(2_000) }
        ).catch(() => undefined);
      }
      eventController.abort();
      if (subscription) {
        await Promise.race([
          subscription.stream.return(undefined).then(() => undefined).catch(() => undefined),
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

  private async start(): Promise<OpencodeClient> {
    if (this.client) return this.client;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<OpencodeClient> {
    const port = await reservePort();
    const password = randomBytes(24).toString("base64url");
    const username = "switchy";
    const child = spawn(
      this.executable,
      ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            share: "disabled",
            autoupdate: false,
            plugin: [],
            instructions: [],
            mcp: {},
            tools: DISABLED_TOOLS,
            permission: { "*": "deny" },
            default_agent: "switchy",
            agent: {
              switchy: {
                description: "Isolated Switchy text generation",
                mode: "primary",
                prompt: "Follow only the system message supplied by Switchy. Never use tools or external context.",
                tools: DISABLED_TOOLS,
                permission: { "*": "deny" },
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
      if (/unknown (?:option|argument)|unrecognized (?:option|argument)|unsupported .*option|unexpected argument/.test(message)) {
        unsupportedStartupOptions = true;
      }
    });

    try {
      const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const { createOpencodeClient } = await this.loadSDK();
      const client = createOpencodeClient({
        baseUrl: `http://127.0.0.1:${port}`,
        headers: { Authorization: authorization },
      });

      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (processError || child.exitCode !== null) break;
        try {
          const health = await client.global.health({
            signal: AbortSignal.timeout(1_000),
          });
          if (health.data) {
            this.version = health.data.version;
            this.client = client;
            this.scheduleIdleShutdown();
            return client;
          }
          if (health.response?.status === 404) {
            throw new AIError({
              type: "validation",
              message: "OpenCode CLI protocol is incompatible",
              retryable: false,
            });
          }
        } catch (error) {
          if (error instanceof AIError && error.type === "validation") throw error;
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
