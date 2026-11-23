import path from "node:path";

import { CLI_VERSION } from "./config.js";
import { restartRuntime, startRuntime, stopRuntime, type StartOptions } from "./controller.js";
import { readJsonFile } from "./files.js";
import { compareVersions, readPreferences, readUpdateState, saveUpdateState } from "./lifecycle-state.js";
import { prepareLifecycleHost } from "./lifecycle.js";
import { readLogTail } from "./logs.js";
import { ensureSwitchyDirectories, getSwitchyPaths } from "./paths.js";
import { getRunningProcess, readProcessRecord, waitForForegroundExit } from "./process-manager.js";
import { resolveLatestStableVersion } from "./release.js";
import type { CurrentVersionRecord } from "./types.js";
import { downloadUpdate, installUpdate } from "./updater.js";

export async function startCommand(options: StartOptions = {}): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  const record = await startRuntime(paths, options);
  if (options.foreground) {
    await waitForForegroundExit(record);
  } else {
    await prepareLifecycleHost(paths, path.join(paths.versions, record.version));
    console.log(`Switchy ${record.version} is running at http://${record.hostname}:${record.port}`);
  }
}

export async function stopCommand(force = false): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  console.log(await stopRuntime(paths, force) ? "Switchy stopped." : "Switchy is not running.");
}

export async function restartCommand(): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  const record = await restartRuntime(paths);
  await prepareLifecycleHost(paths, path.join(paths.versions, record.version));
  console.log(`Switchy ${record.version} restarted at http://${record.hostname}:${record.port}`);
}

async function readStatus() {
  const paths = getSwitchyPaths();
  const running = await getRunningProcess(paths);
  const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
  const status = {
    status: running ? running.live ? "running" : "unresponsive" : "stopped",
    cliVersion: CLI_VERSION, installedVersion: current?.version ?? null,
    previousVersion: current?.previousVersion ?? null, nodeVersion: process.versions.node,
    pid: running?.record.pid ?? null, url: running ? `http://${running.record.hostname}:${running.record.port}` : null,
  };
  return status;
}

export async function statusCommand(json = false): Promise<void> {
  const status = await readStatus();
  if (json) console.log(JSON.stringify(status, null, 2));
  else {
    console.log(`Switchy${status.pid ? ` ${status.installedVersion}` : ""} is ${status.status}.`);
    if (status.pid) console.log(`URL: ${status.url}\nPID: ${status.pid}`);
  }
}

export async function doctorCommand(): Promise<void> {
  const paths = getSwitchyPaths();
  const issues: Record<string, string> = {};
  const inspect = async <T>(name: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch (error) {
      issues[name] = error instanceof Error ? error.message : String(error);
      return null;
    }
  };
  const [status, record, preferences, update, managedNode] = await Promise.all([
    inspect("process", readStatus), inspect("record", () => readProcessRecord(paths)),
    inspect("preferences", () => readPreferences(paths)), inspect("update", () => readUpdateState(paths)),
    inspect("managedNode", () => readJsonFile(path.join(paths.app, "host/node.json"))),
  ]);
  console.log(JSON.stringify({ ...status, cliVersion: CLI_VERSION, home: paths.root, preferences, update, managedNode, issues,
    recordedPid: record?.pid ?? null, applicationLog: paths.logFile,
    lifecycleLog: path.join(paths.logs, "lifecycle.log"),
  }, null, 2));
}

export async function updateCommand(action: "check" | "download" | "install" | "apply" = "install"): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  const staged = (await readUpdateState(paths)).downloadedVersion;
  if (action === "apply" && !staged) throw new Error("No update is downloaded. Run switchy update --download first.");
  const latestVersion = action === "apply" ? staged! : await resolveLatestStableVersion();
  const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
  await saveUpdateState(paths, { latestVersion, lastCheckedAt: new Date().toISOString() });
  if (current && compareVersions(latestVersion, current.version) <= 0) {
    await saveUpdateState(paths, { phase: "idle", message: null });
    console.log(`Switchy ${current.version} is already current.`);
  } else if (action === "check") {
    await saveUpdateState(paths, { phase: "available", message: null });
    console.log(`Switchy ${latestVersion} is available.`);
  } else if (action === "download") {
    await downloadUpdate(paths, latestVersion);
    console.log(`Downloaded Switchy ${latestVersion}. Run switchy update --apply to install.`);
  } else if (await installUpdate(paths, latestVersion, true)) {
    await prepareLifecycleHost(paths, path.join(paths.versions, latestVersion));
    console.log(`Updated to Switchy ${latestVersion}.`);
  } else {
    console.log("Update deferred. Wait for active work to finish and try again.");
  }
}

export async function logsCommand(): Promise<void> {
  console.log(await readLogTail(getSwitchyPaths().logFile));
}

export function versionCommand(): void { console.log(CLI_VERSION); }
