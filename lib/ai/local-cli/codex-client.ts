import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { AIError } from "@/lib/ai/shared/errors";

type NotificationListener = (params: Record<string, unknown>) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
  aborted?: boolean;
  onLateResult?: (value: unknown) => void;
  onLateResultExpired?: () => void;
  timedOut?: boolean;
}

interface CodexRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onLateResult?: (value: unknown) => void;
  onLateResultExpired?: () => void;
}

async function waitForStart(
  promise: Promise<void>,
  signal: AbortSignal | undefined
): Promise<void> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Codex CLI request cancelled", "AbortError")
    );
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Map<string, Set<NotificationListener>>();
  private startPromise: Promise<void> | null = null;
  private ready = false;
  private serverVersion?: string;

  get version(): string | undefined {
    return this.serverVersion;
  }

  constructor(
    private readonly executable: string,
    private readonly lateResultTombstoneMs = 30_000,
    private readonly initializationTimeoutMs = 10_000
  ) {}

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.process && this.ready) return;

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    const child = spawn(this.executable, [
      "app-server",
      "--listen",
      "stdio://",
      "--disable",
      "apps",
      "--disable",
      "browser_use",
      "--disable",
      "browser_use_external",
      "--disable",
      "browser_use_full_cdp_access",
      "--disable",
      "computer_use",
      "--disable",
      "goals",
      "--disable",
      "hooks",
      "--disable",
      "image_generation",
      "--disable",
      "in_app_browser",
      "--disable",
      "memories",
      "--disable",
      "multi_agent",
      "--disable",
      "plugins",
      "--disable",
      "remote_plugin",
      "--disable",
      "shell_tool",
      "--disable",
      "tool_suggest",
      "--disable",
      "unified_exec",
      "--disable",
      "workspace_dependencies",
      "--config",
      'web_search="disabled"',
      "--config",
      "mcp_servers={}",
      "--config",
      "project_doc_max_bytes=0",
      "--config",
      'shell_environment_policy.inherit="none"',
    ], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    let unsupportedStartupOptions = false;

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.receive(line));
    // Inspect a bounded startup signal without retaining or logging stderr.
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8", 0, 1_024).toLowerCase();
      if (/unknown (?:option|argument)|unrecognized (?:option|argument)|unsupported .*option|unexpected argument/.test(message)) {
        unsupportedStartupOptions = true;
      }
    });
    child.once("error", (error) => {
      if (this.process === child) this.failAll(error);
    });
    child.once("exit", () => {
      if (this.process === child) {
        this.failAll(unsupportedStartupOptions
          ? new AIError({
              type: "validation",
              message: "Codex CLI protocol is incompatible",
              retryable: false,
            })
          : new Error("Codex app-server exited"));
      }
    });

    let initialized: Record<string, unknown>;
    try {
      initialized = await this.request<Record<string, unknown>>("initialize", {
        clientInfo: { name: "switchy", title: "Switchy", version: "1" },
      }, { timeoutMs: this.initializationTimeoutMs });
    } catch (error) {
      this.stop();
      throw error;
    }
    this.ready = true;
    const serverInfo = initialized.serverInfo as Record<string, unknown> | undefined;
    this.serverVersion = typeof serverInfo?.version === "string" ? serverInfo.version : undefined;
    this.notify("initialized", {});
  }

  async request<T>(
    method: string,
    params: Record<string, unknown>,
    options: CodexRequestOptions = {}
  ): Promise<T> {
    if (method !== "initialize") await waitForStart(this.start(), options.signal);
    options.signal?.throwIfAborted();
    const child = this.process;
    if (!child || !child.stdin.writable) {
      throw new AIError({
        type: "network",
        message: "Codex app-server is not available",
      });
    }

    const id = this.nextId++;
    const result = new Promise<T>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        pending?.removeAbortListener?.();
        if (pending?.onLateResult) {
          pending.timedOut = true;
          pending.timer = setTimeout(() => {
            this.pending.delete(id);
            pending.onLateResultExpired?.();
          }, this.lateResultTombstoneMs);
          pending.timer.unref?.();
        } else {
          this.pending.delete(id);
        }
        reject(new AIError({
          type: "timeout",
          message: "Codex CLI protocol request timed out",
        }));
      }, timeoutMs);
      timer.unref?.();
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (pending) pending.aborted = true;
        pending?.removeAbortListener?.();
        reject(
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException("Codex CLI request cancelled", "AbortError")
        );
      };
      const removeAbortListener = options.signal
        ? () => options.signal?.removeEventListener("abort", onAbort)
        : undefined;
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        removeAbortListener,
        onLateResult: options.onLateResult,
        onLateResultExpired: options.onLateResultExpired,
      });
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return result;
  }

  notify(method: string, params: Record<string, unknown>): void {
    const child = this.process;
    if (!child?.stdin.writable) return;
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  on(method: string, listener: NotificationListener): () => void {
    const set = this.listeners.get(method) ?? new Set<NotificationListener>();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  stop(): void {
    this.ready = false;
    this.process?.kill("SIGTERM");
    this.process = null;
    this.failAll(new Error("Codex app-server stopped"));
  }

  private receive(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      if (pending.aborted || pending.timedOut) {
        if (!message.error) pending.onLateResult?.(message.result);
        return;
      }
      if (message.error) {
        const rpcError = message.error as Record<string, unknown>;
        const incompatible = rpcError.code === -32601;
        pending.reject(
          new AIError({
            type: incompatible ? "validation" : "generation_failed",
            message: incompatible
              ? "Codex CLI protocol is incompatible"
              : "Codex CLI request failed",
            retryable: false,
          })
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") return;
    const params = message.params;
    if (!params || typeof params !== "object") return;
    for (const listener of this.listeners.get(message.method) ?? []) {
      listener(params as Record<string, unknown>);
    }
  }

  private failAll(error: Error): void {
    const wrapped = error instanceof AIError
      ? error
      : new AIError({
          type: "network",
          message: "Codex CLI process stopped unexpectedly",
          cause: error,
        });
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      pending.reject(wrapped);
    }
    this.pending.clear();
    for (const listener of this.listeners.get("__process/closed") ?? []) {
      listener({ error: wrapped });
    }
    this.ready = false;
    this.process = null;
  }
}
