import path from "node:path";

import { CLI_VERSION } from "./config.js";
import { readJsonFile, withDirectoryLock } from "./files.js";
import { readPreferences } from "./lifecycle-state.js";
import { getRunningProcess, startSwitchyProcess, stopSwitchy } from "./process-manager.js";
import { requestRuntimeStop, setRunningPreference } from "./preferences.js";
import { assertStableVersion } from "./release.js";
import { installUpdate, recoverInterruptedUpdate } from "./updater.js";
import type { CurrentVersionRecord, ProcessRecord, SwitchyPaths } from "./types.js";

export interface StartOptions {
  version?: string;
  port?: number;
  foreground?: boolean;
}

export async function startRuntime(paths: SwitchyPaths, options: StartOptions = {}): Promise<ProcessRecord> {
  const stopToken = (await readPreferences(paths)).stopToken;
  await withDirectoryLock(paths.startLock, () => recoverInterruptedUpdate(paths));
  const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
  const version = assertStableVersion(options.version ?? current?.version ?? CLI_VERSION);
  const port = options.port ?? (await readPreferences(paths)).port;
  if (!current || version !== current.version) {
    const installed = await installUpdate(paths, version, true, { port, foreground: options.foreground });
    if (!installed) throw new Error("Version change deferred. Wait for active work to finish. Downgrades are not supported.");
  }
  return withDirectoryLock(paths.startLock, async () => {
    if ((await readPreferences(paths)).stopToken !== stopToken) throw new Error("Start cancelled by a stop request.");
    const selected = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
    if (!selected) throw new Error("Switchy has no installed runtime");
    const running = await getRunningProcess(paths);
    if (running && !running.live) throw new Error("Switchy is unresponsive. Inspect logs or run stop --force before starting again.");
    if (running && options.foreground && current?.version === version) throw new Error("Stop the running app before starting in foreground mode.");
    const record = running?.record ?? await startSwitchyProcess({
      paths, runtimeDirectory: path.join(paths.versions, selected.version),
      version: selected.version, port, foreground: options.foreground ?? false,
    });
    // Foreground processes belong to their terminal and must not be restarted by the manager.
    await setRunningPreference(paths, !options.foreground, record.port);
    return record;
  });
}

export async function stopRuntime(paths: SwitchyPaths, force = false): Promise<boolean> {
  // A stop during download prevents subsequent activation without waiting for it.
  await requestRuntimeStop(paths);
  return withDirectoryLock(paths.startLock, async () => {
    await requestRuntimeStop(paths);
    return stopSwitchy(paths, force);
  });
}

export async function reconcileRuntime(paths: SwitchyPaths): Promise<ProcessRecord | null> {
  return withDirectoryLock(paths.startLock, async () => {
    await recoverInterruptedUpdate(paths);
    const preferences = await readPreferences(paths);
    const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
    if (!preferences.running || !current) return null;
    const running = await getRunningProcess(paths);
    if (running) return running.record;
    return startSwitchyProcess({ paths, runtimeDirectory: path.join(paths.versions, current.version),
      version: current.version, port: preferences.port, foreground: false });
  });
}

export async function restartRuntime(paths: SwitchyPaths): Promise<ProcessRecord> {
  await requestRuntimeStop(paths);
  return withDirectoryLock(paths.startLock, async () => {
    await requestRuntimeStop(paths);
    await recoverInterruptedUpdate(paths);
    await stopSwitchy(paths);
    const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
    if (!current) throw new Error("Switchy is not installed. Run switchy start first.");
    const preferences = await readPreferences(paths);
    const record = await startSwitchyProcess({ paths, runtimeDirectory: path.join(paths.versions, current.version),
      version: current.version, port: preferences.port, foreground: false });
    await setRunningPreference(paths, true, record.port);
    return record;
  });
}
