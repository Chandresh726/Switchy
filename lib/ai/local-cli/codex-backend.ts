import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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
import { AIError } from "@/lib/ai/shared/errors";

import { CodexAppServerClient } from "./codex-client";

interface CodexModel {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  inputModalities?: string[];
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    description?: string;
  }>;
}

interface CodexTurnResult {
  output: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason?: string;
}

function codexErrorKey(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  return Object.keys(value as Record<string, unknown>)[0];
}

function codexErrorStatus(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (!nested || typeof nested !== "object") continue;
    const status = (nested as Record<string, unknown>).httpStatusCode;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function codexTurnError(errorInfo: unknown, interrupted: boolean): AIError {
  if (interrupted) {
    return new AIError({
      type: "timeout",
      message: "Codex CLI generation was interrupted",
    });
  }

  const key = codexErrorKey(errorInfo);
  const status = codexErrorStatus(errorInfo);
  if (key === "unauthorized" || status === 401 || status === 403) {
    return new AIError({
      type: "missing_api_key",
      message: "Codex CLI authentication is unavailable",
      retryable: false,
    });
  }
  if (key === "usageLimitExceeded" || key === "serverOverloaded" || status === 429) {
    return new AIError({
      type: "rate_limit",
      message: "Codex CLI quota or capacity is temporarily unavailable",
    });
  }
  if (key === "badRequest") {
    return new AIError({
      type: "invalid_model",
      message: "Codex CLI rejected the configured model or request",
      retryable: false,
    });
  }
  if (
    key === "httpConnectionFailed" ||
    key === "responseStreamConnectionFailed" ||
    key === "responseStreamDisconnected"
  ) {
    return new AIError({
      type: "network",
      message: "Codex CLI could not maintain the provider connection",
    });
  }
  return new AIError({
    type: "generation_failed",
    message: "Codex CLI generation failed",
  });
}

const CODEX_BASE_INSTRUCTIONS =
  "You are the isolated text-generation backend for Switchy. Follow only Switchy instructions. Do not use tools, inspect files, access the network, or attempt to change the environment.";

const CODEX_ISOLATED_CONFIG = {
  web_search: "disabled",
  project_doc_max_bytes: 0,
  mcp_servers: {},
  features: {
    apps: false,
    browser_use: false,
    browser_use_external: false,
    browser_use_full_cdp_access: false,
    computer_use: false,
    goals: false,
    hooks: false,
    image_generation: false,
    in_app_browser: false,
    memories: false,
    multi_agent: false,
    plugins: false,
    remote_plugin: false,
    shell_tool: false,
    tool_suggest: false,
    unified_exec: false,
    workspace_dependencies: false,
  },
  shell_environment_policy: {
    inherit: "none",
    include_only: [],
  },
};

export class CodexCLIBackend implements AIGenerationBackend {
  private readonly client: CodexAppServerClient;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private version?: string;
  private activeOperations = 0;
  private restartWhenIdle = false;
  private readonly reasoningEffortsByModel = new Map<string, string[]>();

  constructor(
    private readonly executable: string,
    private readonly idleShutdownMs = CLI_IDLE_SHUTDOWN_MS,
    private readonly protocolRequestTimeoutMs = 10_000,
    lateResultTombstoneMs = 30_000,
    initializationTimeoutMs = 10_000
  ) {
    this.client = new CodexAppServerClient(
      executable,
      lateResultTombstoneMs,
      initializationTimeoutMs
    );
  }

  retire(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.requestRestartWhenIdle();
  }

  async readAccount(): Promise<{ authenticated: boolean }> {
    this.beginOperation();
    try {
      const response = await this.client.request<{
        account?: unknown;
        requiresOpenaiAuth?: boolean;
      }>("account/read", {});
      return {
        authenticated:
          (response.account !== null && response.account !== undefined) ||
          response.requiresOpenaiAuth === false,
      };
    } finally {
      this.endOperation();
    }
  }

  async listModels(): Promise<ProviderModelDefinition[]> {
    this.beginOperation();
    try {
      const models: CodexModel[] = [];
      let cursor: string | null | undefined;
      do {
        const response = await this.client.request<{
          data?: CodexModel[];
          nextCursor?: string | null;
        }>("model/list", cursor ? { cursor, limit: 100 } : { limit: 100 });
        models.push(...(response.data ?? []));
        cursor = response.nextCursor;
      } while (cursor);

      return models
      .filter(
        (model) =>
          !model.hidden &&
          (model.inputModalities?.length ? model.inputModalities.includes("text") : true)
      )
      .map((model) => {
        const reasoningControl = createEffortReasoningControl(
          (model.supportedReasoningEfforts ?? []).flatMap((entry) =>
            isReasoningEffort(entry.reasoningEffort)
              ? [{
                  value: entry.reasoningEffort,
                  ...(entry.description ? { description: entry.description } : {}),
                }]
              : []
          ),
          model.defaultReasoningEffort
        );
        const efforts = reasoningControl.kind === "effort"
          ? reasoningControl.options.map(({ value }) => value)
          : [];
        const modelId = model.model ?? model.id ?? "";
        this.reasoningEffortsByModel.set(modelId, efforts);
        return withReasoningControl({
          modelId,
          label: model.displayName ?? model.model ?? model.id ?? "",
          description: model.description ?? "",
          isDefault: model.isDefault ?? false,
        }, reasoningControl);
      })
      .filter((model) => Boolean(model.modelId));
    } finally {
      this.endOperation();
    }
  }

  setModelReasoningEfforts(modelId: string, efforts: string[]): void {
    this.reasoningEffortsByModel.set(modelId, [...efforts]);
  }

  async getVersion(): Promise<string | undefined> {
    if (this.version) return this.version;
    this.version = await new Promise<string | undefined>((resolve) => {
      const child = spawn(this.executable, ["--version"], {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), 5_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (output.length < 200) output += chunk.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        const match = code === 0 ? output.match(/\d+\.\d+(?:\.\d+)?/) : null;
        resolve(match?.[0]);
      });
    });
    return this.version;
  }

  async generateText(input: BackendTextInput): Promise<BackendResult<string>> {
    const result = await this.runTurn(input);
    return { ...result, warningCodes: [] };
  }

  async streamText(input: BackendStreamingInput): Promise<BackendResult<string>> {
    const result = await this.runTurn(input, undefined, input.onDelta);
    return { ...result, warningCodes: [] };
  }

  async generateStructured<T>(
    input: BackendStructuredInput<T>
  ): Promise<BackendResult<T>> {
    const result = await this.runTurn(input, input.jsonSchema);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.output);
    } catch (error) {
      throw new AIError({ type: "json_parse", message: "Codex CLI returned malformed JSON", cause: error instanceof Error ? error : undefined });
    }
    return { ...result, output: input.validate(parsed), warningCodes: [] };
  }

  private async runTurn(
    input: BackendTextInput,
    outputSchema?: Record<string, unknown>,
    onDelta?: (delta: string) => void | Promise<void>
  ): Promise<CodexTurnResult> {
    input.signal.throwIfAborted();
    if (input.maxOutputTokens !== undefined) {
      throw new AIError({
        type: "validation",
        message: "Codex CLI does not expose an enforceable per-turn output-token limit",
        retryable: false,
      });
    }
    const cwd = await mkdtemp(path.join(tmpdir(), "switchy-codex-"));
    this.beginOperation();
    let threadId: string | undefined;
    let turnId: string | undefined;
    let rejectCompletion: ((error: Error) => void) | undefined;
    const disposers: Array<() => void> = [];
    const abortReason = () => input.signal.reason instanceof Error
      ? input.signal.reason
      : new DOMException("AI execution cancelled", "AbortError");
    const onAbort = () => {
      if (threadId && turnId) {
        void this.client.request("turn/interrupt", { threadId, turnId }, { timeoutMs: 1_000 })
          .catch(() => this.requestRestartWhenIdle());
      }
      rejectCompletion?.(abortReason());
    };
    input.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const thread = await this.client.request<{ thread: { id: string } }>("thread/start", {
        approvalPolicy: "never",
        baseInstructions: CODEX_BASE_INSTRUCTIONS,
        config: CODEX_ISOLATED_CONFIG,
        developerInstructions: input.instructions,
        cwd,
        ephemeral: true,
        model: input.modelId,
        sandbox: "read-only",
      }, { signal: input.signal });
      threadId = thread.thread.id;

      let output = "";
      let deltaDelivery = Promise.resolve();
      let usage: CodexTurnResult["usage"] = {};
      let finishReason: string | undefined;
      const pendingNotifications: Array<() => void> = [];
      let settle!: (value: CodexTurnResult) => void;
      let reject!: (error: Error) => void;
      const completed = new Promise<CodexTurnResult>((resolve, rejectPromise) => {
        settle = resolve;
        reject = rejectPromise;
        rejectCompletion = rejectPromise;
      });
      // The process can fail between turn creation and the later await. Attach a
      // handler immediately so Node does not report a transient unhandled rejection.
      void completed.catch(() => undefined);

      const forCurrentTurn = (
        notificationTurnId: unknown,
        callback: () => void
      ) => {
        if (typeof notificationTurnId !== "string") return;
        if (!turnId) {
          pendingNotifications.push(() => {
            if (notificationTurnId === turnId) callback();
          });
          return;
        }
        if (notificationTurnId === turnId) callback();
      };

      disposers.push(
        this.client.on("__process/closed", (params) => {
          reject(
            params.error instanceof Error
              ? params.error
              : new AIError({ type: "network", message: "Codex CLI process stopped unexpectedly" })
          );
        }),
        this.client.on("item/agentMessage/delta", (params) => {
          if (params.threadId !== threadId) return;
          forCurrentTurn(params.turnId, () => {
            if (typeof params.delta !== "string") return;
            output += params.delta;
            deltaDelivery = deltaDelivery.then(() => onDelta?.(params.delta as string));
          });
        }),
        this.client.on("thread/tokenUsage/updated", (params) => {
          if (params.threadId !== threadId) return;
          forCurrentTurn(params.turnId, () => {
            const tokenUsage = params.tokenUsage as Record<string, unknown> | undefined;
            const total = tokenUsage?.total as Record<string, unknown> | undefined;
            usage = {
              inputTokens: typeof total?.inputTokens === "number" ? total.inputTokens : undefined,
              outputTokens: typeof total?.outputTokens === "number" ? total.outputTokens : undefined,
              totalTokens: typeof total?.totalTokens === "number" ? total.totalTokens : undefined,
            };
          });
        }),
        this.client.on("turn/completed", (params) => {
          if (params.threadId !== threadId) return;
          const turn = params.turn as Record<string, unknown> | undefined;
          forCurrentTurn(turn?.id, () => {
            const status = turn?.status;
            if (status === "failed" || status === "interrupted") {
              const turnError = turn?.error as Record<string, unknown> | undefined;
              reject(codexTurnError(turnError?.codexErrorInfo, status === "interrupted"));
              return;
            }
            finishReason = typeof status === "string" ? status : "stop";
            void deltaDelivery.then(
              () => settle({ output, usage, finishReason }),
              (error) => reject(error instanceof Error ? error : new Error("Writing stream failed"))
            );
          });
        })
      );

      const knownReasoningEfforts = this.reasoningEffortsByModel.get(input.modelId);
      if (input.reasoningEffort && knownReasoningEfforts && knownReasoningEfforts.length > 0 &&
          !knownReasoningEfforts.includes(input.reasoningEffort)) {
        throw new AIError({
          type: "reasoning_not_supported",
          message: "The selected reasoning effort is unavailable for this Codex model",
          retryable: false,
        });
      }

      const started = await this.client.request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
        model: input.modelId,
        effort: input.reasoningEffort && knownReasoningEfforts?.includes(input.reasoningEffort)
          ? input.reasoningEffort
          : undefined,
        ...(outputSchema ? { outputSchema } : {}),
      }, {
        signal: input.signal,
        timeoutMs: this.protocolRequestTimeoutMs,
        onLateResult: (value) => {
          const late = value as { turn?: { id?: unknown } };
          if (typeof late.turn?.id !== "string" || !threadId) return;
          void this.client.request(
            "turn/interrupt",
            { threadId, turnId: late.turn.id },
            { timeoutMs: 1_000 }
          ).catch(() => this.requestRestartWhenIdle());
        },
        onLateResultExpired: () => this.requestRestartWhenIdle(),
      });
      turnId = started.turn.id;
      pendingNotifications.splice(0).forEach((deliver) => deliver());

      if (input.signal.aborted) onAbort();
      return await completed;
    } catch (error) {
      if (input.signal.aborted) throw abortReason();
      throw error;
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      disposers.forEach((dispose) => dispose());
      await rm(cwd, { recursive: true, force: true });
      this.endOperation();
    }
  }

  private beginOperation(): void {
    this.activeOperations += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private endOperation(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    if (this.activeOperations > 0) return;
    if (this.restartWhenIdle) {
      this.restartWhenIdle = false;
      this.client.stop();
      return;
    }
    this.idleTimer = setTimeout(() => this.client.stop(), this.idleShutdownMs);
    this.idleTimer.unref?.();
  }

  private requestRestartWhenIdle(): void {
    this.restartWhenIdle = true;
    if (this.activeOperations === 0) {
      this.restartWhenIdle = false;
      this.client.stop();
    }
  }
}
