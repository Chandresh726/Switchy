import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getSwitchyRootDirectory } from "@/lib/state/layout";

import { lifecycleFiles, readPreferences, readUpdateState, writeJsonFileAtomic } from "./lifecycle-state";

const execute = promisify(execFile);

function paths() {
  const root = getSwitchyRootDirectory();
  return { root, runtime: path.join(root, "runtime"), app: path.join(root, "app") };
}

export async function getLifecycleStatus() {
  const statePaths = paths();
  const supported = process.env.NODE_ENV === "production" && existsSync(path.join(process.cwd(), "bin/lifecycle.cjs"));
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
  await writeJsonFileAtomic(lifecycleFiles(paths()).request, { action });
}

export async function recordBrowserHeartbeat(id: string): Promise<void> {
  const directory = lifecycleFiles(paths()).browser;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, id), "", { mode: 0o600 });
}
