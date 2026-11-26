import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./atomic-file";
import type { UpdateProgress, UpdateStage } from "./update-progress";

export interface LifecyclePaths {
  root: string;
  runtime: string;
  app: string;
}

export interface LifecyclePreferences {
  startAtLogin: boolean;
  openAtLogin: boolean;
  automaticUpdates: boolean;
  running: boolean;
  stopToken?: string;
  port: number;
}

export interface UpdateState {
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "waiting" | "installing" | "failed";
  lastCheckedAt: string | null;
  latestVersion: string | null;
  failedVersion: string | null;
  downloadedVersion?: string | null;
  message: string | null;
  progress?: UpdateProgress | null;
  timings?: Partial<Record<UpdateStage, number>>;
}

export interface UpdateTransaction {
  fromVersion: string | null;
  hadData?: boolean;
  toVersion: string;
  snapshot: string | null;
  previousVersion?: string | null;
  port: number;
  stage: "prepared" | "stopped" | "snapshot" | "starting" | "committed";
}

const DEFAULT_PREFERENCES: LifecyclePreferences = {
  startAtLogin: false, openAtLogin: false, automaticUpdates: false,
  running: true, port: 6767,
};
const DEFAULT_UPDATE_STATE: UpdateState = {
  phase: "idle", lastCheckedAt: null, latestVersion: null, failedVersion: null, downloadedVersion: null, message: null, progress: null, timings: {},
};

export function lifecycleFiles(paths: LifecyclePaths) {
  return {
    preferences: path.join(paths.runtime, "lifecycle.json"),
    state: path.join(paths.runtime, "update-state.json"),
    transaction: path.join(paths.runtime, "update-transaction.json"),
    maintenance: path.join(paths.runtime, "update-maintenance.json"),
    browser: path.join(paths.runtime, "browser-heartbeats"),
    request: path.join(paths.runtime, "update-request.json"),
    requests: path.join(paths.runtime, "update-requests"),
    updateLock: path.join(paths.runtime, "update.lock"),
    hostLock: path.join(paths.runtime, "host.lock"),
    supervisorLock: path.join(paths.runtime, "supervisor.lock"),
    preferencesLock: path.join(paths.runtime, "preferences.lock"),
    host: path.join(paths.app, "host"),
  };
}

export async function readPreferences(paths: LifecyclePaths): Promise<LifecyclePreferences> {
  const value = await readJsonFile<LifecyclePreferences>(lifecycleFiles(paths).preferences);
  if (!value) return { ...DEFAULT_PREFERENCES };
  if (["startAtLogin", "openAtLogin", "automaticUpdates", "running"].some(
    (key) => typeof value[key as keyof LifecyclePreferences] !== "boolean"
  ) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new Error("Switchy startup preferences are invalid");
  }
  return value;
}

export async function readUpdateState(paths: LifecyclePaths): Promise<UpdateState> {
  return { ...DEFAULT_UPDATE_STATE, ...await readJsonFile<UpdateState>(lifecycleFiles(paths).state) };
}

export async function saveUpdateState(paths: LifecyclePaths, changes: Partial<UpdateState>): Promise<void> {
  const previous = await readUpdateState(paths);
  const next = { ...previous, ...changes };
  if (JSON.stringify(previous) !== JSON.stringify(next)) await writeJsonFileAtomic(lifecycleFiles(paths).state, next);
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

export { predatesCurrentBoot } from "./process-identity";
