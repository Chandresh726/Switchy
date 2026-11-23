import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getSwitchyRootDirectory } from "@/lib/state/layout";

import { enqueueUpdateRequest } from "./update-requests";
import { lifecycleFiles, readPreferences, readUpdateState } from "./lifecycle-state";

const execute = promisify(execFile);

function paths() {
  const root = getSwitchyRootDirectory();
  return { root, runtime: path.join(root, "runtime"), app: path.join(root, "app") };
}

export function isLifecycleSupported(): boolean {
  return process.env.NODE_ENV === "production" && existsSync(path.join(process.cwd(), "bin/lifecycle.cjs"));
}

export async function getLifecycleStatus() {
  const statePaths = paths();
  const supported = isLifecycleSupported();
  return {
    supported, startupSupported: supported && process.platform === "darwin",
    preferences: await readPreferences(statePaths), update: await readUpdateState(statePaths),
  };
}

export async function changeLifecyclePreferences(changes: Record<string, boolean>): Promise<void> {
  if (!(await getLifecycleStatus()).supported) throw new Error("Startup and updates require a packaged production build");
  await execute(process.execPath, [path.join(process.cwd(), "bin/lifecycle.cjs"), "configure", JSON.stringify(changes)], {
    env: { ...process.env, SWITCHY_HOME: getSwitchyRootDirectory() }, timeout: 30_000,
  });
}

export async function requestLifecycleUpdate(action: "check" | "download" | "install"): Promise<void> {
  if (!(await getLifecycleStatus()).supported) throw new Error("Updates require a packaged production build");
  const state = await readUpdateState(paths());
  await enqueueUpdateRequest(paths(), action, action === "check" ? undefined : state.latestVersion ?? undefined);
}

export async function recordBrowserHeartbeat(id: string): Promise<void> {
  if (!isLifecycleSupported()) return;
  const directory = lifecycleFiles(paths()).browser;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, id), "", { mode: 0o600 });
}
