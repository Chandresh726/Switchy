import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface LifecyclePaths {
  root: string;
  runtime: string;
  app: string;
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export interface LifecyclePreferences {
  startAtLogin: boolean;
  openAtLogin: boolean;
  automaticUpdates: boolean;
  consented: boolean;
  running: boolean;
  port: number;
}

interface UpdateState {
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "waiting" | "installing" | "failed";
  lastCheckedAt: string | null;
  latestVersion: string | null;
  failedVersion: string | null;
  downloadedVersion?: string | null;
  message: string | null;
}

export interface UpdateTransaction {
  fromVersion: string;
  toVersion: string;
  snapshot: string | null;
  port: number;
  stage: "prepared" | "stopped" | "snapshot" | "starting" | "committed";
}

const DEFAULT_PREFERENCES: LifecyclePreferences = {
  startAtLogin: false, openAtLogin: false, automaticUpdates: false,
  consented: false, running: true, port: 6767,
};
const DEFAULT_UPDATE_STATE: UpdateState = {
  phase: "idle", lastCheckedAt: null, latestVersion: null, failedVersion: null, downloadedVersion: null, message: null,
};

export function lifecycleFiles(paths: LifecyclePaths) {
  return {
    preferences: path.join(paths.runtime, "lifecycle.json"),
    state: path.join(paths.runtime, "update-state.json"),
    transaction: path.join(paths.runtime, "update-transaction.json"),
    maintenance: path.join(paths.runtime, "update-maintenance.json"),
    browser: path.join(paths.runtime, "browser-heartbeats"),
    request: path.join(paths.runtime, "update-request.json"),
    preferencesLock: path.join(paths.runtime, "preferences.lock"),
    host: path.join(paths.app, "host"),
  };
}

export async function readPreferences(paths: LifecyclePaths): Promise<LifecyclePreferences> {
  const value = await readJsonFile<LifecyclePreferences>(lifecycleFiles(paths).preferences);
  if (!value) return { ...DEFAULT_PREFERENCES };
  if (["startAtLogin", "openAtLogin", "automaticUpdates", "consented", "running"].some(
    (key) => typeof value[key as keyof LifecyclePreferences] !== "boolean"
  ) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new Error("Switchy startup preferences are invalid");
  }
  return value;
}

export async function readUpdateState(paths: LifecyclePaths): Promise<UpdateState> {
  return await readJsonFile<UpdateState>(lifecycleFiles(paths).state) ?? { ...DEFAULT_UPDATE_STATE };
}

export async function saveUpdateState(paths: LifecyclePaths, changes: Partial<UpdateState>): Promise<void> {
  await writeJsonFileAtomic(lifecycleFiles(paths).state, { ...await readUpdateState(paths), ...changes });
}

export function compareVersions(left: string, right: string): number {
  if (![left, right].every((value) => /^\d+\.\d+\.\d+$/u.test(value))) {
    throw new Error("Invalid stable version");
  }
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function predatesCurrentBoot(startedAt?: string): boolean {
  try {
    return Boolean(startedAt && Date.parse(startedAt) < Date.now() - os.uptime() * 1000 - 10_000);
  } catch {
    // Restricted environments may not expose uptime. Retain the PID check.
    return false;
  }
}
