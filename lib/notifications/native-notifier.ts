import type { ChildProcess } from "node:child_process";

import { ValidationError } from "@/lib/api";

const HELPER_STARTUP_TIMEOUT_MS = 10_000;
const HELPER_REQUEST_TIMEOUT_MS = 10_000;
const PERMISSION_REQUEST_TIMEOUT_MS = 45_000;
const NOTIFICATION_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
  + "?bundleId=in.slope726.switchy.notifications";

const spawnProcess = process.getBuiltinModule("node:child_process").spawn;

export type NativeNotificationPermission =
  | "granted"
  | "denied"
  | "not_determined"
  | "unavailable";

interface NativeNotificationInput {
  title: string;
  body: string;
  path: string;
}

type HelperMessage = {
  event: "ready";
} | {
  event: "response";
  request_id: string;
  success: boolean;
  id?: string;
  permission?: string;
  error?: string;
} | {
  event: "protocol_error";
  error?: string;
};

type HelperResponse = Extract<HelperMessage, { event: "response" }>;

interface PendingRequest {
  resolve: (response: HelperResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface HelperRuntime {
  process: ChildProcess | null;
  starting: Promise<ChildProcess> | null;
  ready: (() => void) | null;
  buffer: string;
  pending: Map<string, PendingRequest>;
}

declare global {
  var __switchyNotificationHelper: HelperRuntime | undefined;
}

function getRuntime(): HelperRuntime {
  globalThis.__switchyNotificationHelper ??= {
    process: null,
    starting: null,
    ready: null,
    buffer: "",
    pending: new Map(),
  };
  return globalThis.__switchyNotificationHelper;
}

function helperPath(): string {
  const configured = process.env.SWITCHY_MACOS_NOTIFICATION_HELPER;
  if (!configured) throw new Error("macOS notification helper path is not configured");
  return configured;
}

/**
 * Builds the loopback URL a notification click should open. This is the single
 * place a destination is validated: the helper only ever receives URLs produced
 * here.
 */
function localDestination(relativePath: string): string {
  if (!relativePath.startsWith("/")) {
    throw new Error("Notification destinations must be local application paths");
  }
  const configuredPort = Number(process.env.PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : process.env.NODE_ENV === "production" ? 6767 : 3000;
  const origin = `http://127.0.0.1:${port}`;
  const destination = new URL(relativePath, origin);
  if (
    destination.origin !== origin
    || destination.username.length > 0
    || destination.password.length > 0
  ) {
    throw new Error("Notification destinations must stay within Switchy");
  }
  return destination.toString();
}

function failPendingRequests(runtime: HelperRuntime, error: Error): void {
  for (const pending of runtime.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  runtime.pending.clear();
}

function detachHelper(runtime: HelperRuntime, child: ChildProcess, error: Error): void {
  if (runtime.process === child) {
    runtime.process = null;
    runtime.buffer = "";
  }
  failPendingRequests(runtime, error);
}

function handleHelperMessage(runtime: HelperRuntime, line: string): void {
  let message: HelperMessage;
  try {
    message = JSON.parse(line) as HelperMessage;
  } catch {
    console.error("[Notifications] Notification helper returned invalid JSON");
    return;
  }

  if (message.event === "ready") {
    runtime.ready?.();
    return;
  }
  if (message.event === "protocol_error") {
    console.error(
      "[Notifications] Notification helper rejected a command:",
      message.error ?? "unknown protocol error"
    );
    return;
  }
  if (message.event !== "response" || typeof message.request_id !== "string") return;

  const pending = runtime.pending.get(message.request_id);
  if (!pending) return;
  runtime.pending.delete(message.request_id);
  clearTimeout(pending.timer);
  if (message.success) pending.resolve(message);
  else pending.reject(new Error(message.error ?? "Native notification request failed"));
}

function consumeHelperOutput(runtime: HelperRuntime, chunk: string): void {
  runtime.buffer += chunk;
  const lines = runtime.buffer.split("\n");
  runtime.buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim()) handleHelperMessage(runtime, line);
  }
}

function spawnHelper(runtime: HelperRuntime): Promise<ChildProcess> {
  const executable = helperPath();
  return new Promise<ChildProcess>((resolve, reject) => {
    const child = spawnProcess(executable, [], { stdio: ["pipe", "pipe", "inherit"] });
    runtime.process = child;
    runtime.buffer = "";

    let settled = false;
    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runtime.ready = null;
      if (error) reject(error);
      else resolve(child);
    }

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Notification helper did not start in time"));
    }, HELPER_STARTUP_TIMEOUT_MS);
    timer.unref();

    runtime.ready = () => finish();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => consumeHelperOutput(runtime, chunk));
    child.on("error", (error) => {
      detachHelper(runtime, child, error);
      finish(error);
    });
    child.on("exit", (code, signal) => {
      const error = new Error(
        `Notification helper exited (code=${code}, signal=${signal})`
      );
      detachHelper(runtime, child, error);
      finish(error);
    });
  });
}

function startHelper(runtime: HelperRuntime): Promise<ChildProcess> {
  const running = runtime.process;
  if (running && running.exitCode === null && !running.killed) {
    return Promise.resolve(running);
  }
  if (runtime.starting) return runtime.starting;

  const starting = spawnHelper(runtime).finally(() => {
    if (runtime.starting === starting) runtime.starting = null;
  });
  runtime.starting = starting;
  return starting;
}

async function helperRequest(
  action: "permission" | "show" | "quit",
  payload: Record<string, unknown> = {},
  timeoutMs = HELPER_REQUEST_TIMEOUT_MS
): Promise<HelperResponse> {
  const runtime = getRuntime();
  const child = await startHelper(runtime);
  return new Promise<HelperResponse>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      runtime.pending.delete(requestId);
      reject(new Error("Notification helper did not respond in time"));
    }, timeoutMs);
    timer.unref();
    runtime.pending.set(requestId, { resolve, reject, timer });

    child.stdin?.write(
      `${JSON.stringify({ action, request_id: requestId, ...payload })}\n`,
      (error) => {
        if (!error) return;
        const pending = runtime.pending.get(requestId);
        if (!pending) return;
        runtime.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.reject(error);
      }
    );
  });
}

function notificationUnavailable(error: unknown): ValidationError {
  if (error instanceof ValidationError) return error;
  console.error("[Notifications] Native notification delivery failed:", error);
  return new ValidationError(
    "Switchy could not access native notifications. Check notification permission in "
    + "System Settings, then try again.",
    "native_notifications_unavailable",
    400
  );
}

function normalizedPermission(value: unknown): NativeNotificationPermission {
  return value === "granted" || value === "denied" || value === "not_determined"
    ? value
    : "unavailable";
}

async function notificationPermission(request: boolean): Promise<{
  success: true;
  permission: NativeNotificationPermission;
}> {
  if (process.platform !== "darwin") return { success: true, permission: "unavailable" };
  try {
    const response = await helperRequest(
      "permission",
      { request },
      request ? PERMISSION_REQUEST_TIMEOUT_MS : HELPER_REQUEST_TIMEOUT_MS
    );
    return { success: true, permission: normalizedPermission(response.permission) };
  } catch (error) {
    console.error("[Notifications] Failed to check native permission:", error);
    return { success: true, permission: "unavailable" };
  }
}

export function getNativeNotificationPermission(): Promise<{
  success: true;
  permission: NativeNotificationPermission;
}> {
  return notificationPermission(false);
}

export function prepareNativeNotifications(): Promise<{
  success: true;
  permission: NativeNotificationPermission;
}> {
  return notificationPermission(true);
}

export async function stopNativeNotifications(): Promise<{ success: true }> {
  const runtime = globalThis.__switchyNotificationHelper;
  const child = runtime?.process;
  if (!runtime || !child) return { success: true };

  try {
    await helperRequest("quit");
  } catch {
    // The helper is already gone, or never answered; make sure it cannot linger.
    child.kill();
  }
  return { success: true };
}

export function openNativeNotificationSettings(): { success: true } {
  if (process.platform !== "darwin") {
    throw new ValidationError(
      "Native notification settings are not available on this platform.",
      "native_notification_settings_unavailable",
      400
    );
  }
  const child = spawnProcess("open", [NOTIFICATION_SETTINGS_URL], {
    detached: true,
    stdio: "ignore",
  });
  child.once("error", (error) => {
    console.error("[Notifications] Failed to open macOS notification settings:", error);
  });
  child.unref();
  return { success: true };
}

export async function sendNativeNotification(input: NativeNotificationInput): Promise<void> {
  if (process.platform !== "darwin") {
    throw new ValidationError(
      "Native notifications are only available on macOS.",
      "native_notifications_unavailable",
      400
    );
  }
  const url = localDestination(input.path);
  try {
    const response = await helperRequest("show", {
      id: crypto.randomUUID(),
      title: input.title,
      body: input.body,
      url,
    });
    if (!response.id) throw new Error("Notification helper did not confirm delivery");
  } catch (error) {
    throw notificationUnavailable(error);
  }
}
