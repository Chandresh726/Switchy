import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SwitchyPaths } from "./types.js";

export function getSwitchyPaths(
  configuredRoot = process.env.SWITCHY_HOME
): SwitchyPaths {
  const override = configuredRoot?.trim();
  if (override && !path.isAbsolute(override)) {
    throw new Error("SWITCHY_HOME must be an absolute path");
  }
  const root = override
    ? path.normalize(override)
    : path.join(os.homedir(), ".switchy");
  const data = path.join(root, "data");
  const app = path.join(root, "app");
  const runtime = path.join(root, "runtime");
  const logs = path.join(root, "logs");
  const cache = path.join(root, "cache");
  return {
    root,
    data,
    productionData: path.join(data, "production"),
    app,
    versions: path.join(app, "versions"),
    currentVersion: path.join(app, "current.json"),
    runtime,
    processRecord: path.join(runtime, "process.json"),
    installLock: path.join(runtime, "install.lock"),
    startLock: path.join(runtime, "start.lock"),
    logs,
    logFile: path.join(logs, "switchy.log"),
    cache,
    downloads: path.join(cache, "downloads"),
    playwright: path.join(cache, "playwright"),
    updateSnapshots: path.join(root, "update-snapshots"),
  };
}

export async function ensureSwitchyDirectories(paths: SwitchyPaths): Promise<void> {
  for (const directory of [
    paths.root,
    paths.data,
    paths.app,
    paths.versions,
    paths.runtime,
    paths.logs,
    paths.cache,
    paths.downloads,
    paths.playwright,
    paths.updateSnapshots,
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
}
