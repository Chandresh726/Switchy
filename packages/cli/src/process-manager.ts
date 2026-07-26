import { open } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_HOSTNAME,
  SHUTDOWN_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
} from "./config.js";
import {
  readJsonFile,
  removeFile,
  writeJsonFileAtomic,
} from "./files.js";
import type { ProcessRecord, SwitchyPaths } from "./types.js";

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readProcessRecord(
  paths: SwitchyPaths
): Promise<ProcessRecord | null> {
  const record = await readJsonFile<ProcessRecord>(paths.processRecord)
    .catch(() => null);
  if (
    !record
    || record.schemaVersion !== 1
    || !Number.isInteger(record.pid)
    || record.pid <= 0
    || typeof record.instanceId !== "string"
    || record.instanceId.length === 0
    || !/^\d+\.\d+\.\d+$/u.test(record.version)
    || record.hostname !== DEFAULT_HOSTNAME
    || !Number.isInteger(record.port)
    || record.port < 1
    || record.port > 65_535
    || !Number.isFinite(Date.parse(record.startedAt))
  ) {
    return null;
  }
  return record;
}

export async function fetchLiveness(record: ProcessRecord): Promise<{
  status: "live";
  version: string;
  instanceId: string | null;
} | null> {
  try {
    const response = await fetch(
      `http://${record.hostname}:${record.port}/api/health/live`,
      { signal: AbortSignal.timeout(2_000) }
    );
    if (!response.ok) return null;
    const value = await response.json() as {
      status?: unknown;
      version?: unknown;
      instanceId?: unknown;
    };
    if (value.status !== "live" || typeof value.version !== "string") return null;
    return {
      status: "live",
      version: value.version,
      instanceId: typeof value.instanceId === "string" ? value.instanceId : null,
    };
  } catch {
    return null;
  }
}

export async function getRunningProcess(
  paths: SwitchyPaths
): Promise<{ record: ProcessRecord; live: Awaited<ReturnType<typeof fetchLiveness>> } | null> {
  const record = await readProcessRecord(paths);
  if (!record) {
    await removeFile(paths.processRecord);
    return null;
  }
  if (!processIsAlive(record.pid)) {
    await removeFile(paths.processRecord);
    return null;
  }
  return { record, live: await fetchLiveness(record) };
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !processIsAlive(pid);
}

async function signalProcessTree(
  pid: number,
  signal: "SIGTERM" | "SIGKILL"
): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      try {
        process.kill(pid, signal);
      } catch (fallbackError) {
        if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") {
          throw fallbackError;
        }
      }
      return;
    }
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "taskkill",
      [
        "/PID",
        String(pid),
        "/T",
        "/F",
      ],
      { stdio: "ignore", windowsHide: true }
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || !processIsAlive(pid)) resolve();
      else reject(new Error(`taskkill exited with code ${code}`));
    });
  });
}

export async function stopSwitchy(
  paths: SwitchyPaths,
  force = false
): Promise<boolean> {
  const running = await getRunningProcess(paths);
  if (!running) return false;
  if (
    !force
    && (
      !running.live
      || running.live.instanceId !== running.record.instanceId
    )
  ) {
    throw new Error(
      "The recorded process could not be verified as Switchy. Re-run with stop --force."
    );
  }

  await signalProcessTree(
    running.record.pid,
    force ? "SIGKILL" : "SIGTERM"
  );
  if (!(await waitForExit(running.record.pid, SHUTDOWN_TIMEOUT_MS))) {
    throw new Error("Switchy did not stop in time. Re-run with stop --force.");
  }
  await removeFile(paths.processRecord);
  return true;
}

async function waitUntilReady(record: ProcessRecord): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processIsAlive(record.pid)) {
      throw new Error("Switchy exited before becoming ready");
    }
    try {
      const response = await fetch(
        `http://${record.hostname}:${record.port}/api/health/ready`,
        { signal: AbortSignal.timeout(2_000) }
      );
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Switchy did not become ready within 60 seconds");
}

export async function startSwitchyProcess({
  paths,
  runtimeDirectory,
  version,
  port,
  foreground,
}: {
  paths: SwitchyPaths;
  runtimeDirectory: string;
  version: string;
  port: number;
  foreground: boolean;
}): Promise<ProcessRecord> {
  const instanceId = randomUUID();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: DEFAULT_HOSTNAME,
    PORT: String(port),
    SWITCHY_HOME: paths.root,
    SWITCHY_INSTANCE_ID: instanceId,
    PLAYWRIGHT_BROWSERS_PATH: paths.playwright,
  };
  const serverPath = path.join(runtimeDirectory, "server.js");
  const logHandle = foreground
    ? null
    : await open(paths.logFile, "a", 0o600);
  const child = spawn(process.execPath, [serverPath], {
    cwd: runtimeDirectory,
    detached: !foreground,
    env: environment,
    stdio: foreground
      ? "inherit"
      : ["ignore", logHandle!.fd, logHandle!.fd],
  });
  await logHandle?.close();
  if (!child.pid) throw new Error("Switchy did not return a process ID");

  const record: ProcessRecord = {
    schemaVersion: 1,
    pid: child.pid,
    instanceId,
    version,
    hostname: DEFAULT_HOSTNAME,
    port,
    startedAt: new Date().toISOString(),
  };
  await writeJsonFileAtomic(paths.processRecord, record);

  if (foreground) {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Switchy exited with code ${code}`));
      });
    }).finally(() => removeFile(paths.processRecord));
    return record;
  }

  child.unref();
  try {
    await waitUntilReady(record);
    return record;
  } catch (error) {
    if (processIsAlive(record.pid)) {
      await signalProcessTree(record.pid, "SIGTERM");
      if (!(await waitForExit(record.pid, SHUTDOWN_TIMEOUT_MS))) {
        await signalProcessTree(record.pid, "SIGKILL");
        if (!(await waitForExit(record.pid, SHUTDOWN_TIMEOUT_MS))) {
          throw new Error(
            `Switchy failed to start and process ${record.pid} could not be stopped`,
            { cause: error }
          );
        }
      }
    }
    await removeFile(paths.processRecord);
    throw error;
  }
}
