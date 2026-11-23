import path from "node:path";

import { readJsonFile, removeFile, withDirectoryLock, writeJsonFileAtomic } from "./files.js";
import { compareVersions, lifecycleFiles, readPreferences, readUpdateState, saveUpdateState } from "./lifecycle-state.js";
import type { LifecyclePreferences } from "./lifecycle-state.js";
import { ensureSwitchyDirectories, getSwitchyPaths } from "./paths.js";
import { getRunningProcess, startSwitchyProcess } from "./process-manager.js";
import { resolveLatestStableVersion } from "./release.js";
import { installHost, setStartupRegistration, startHost } from "./startup.js";
import type { CurrentVersionRecord, SwitchyPaths } from "./types.js";
import { downloadUpdate, installUpdate, recoverInterruptedUpdate } from "./updater.js";

export async function configureLifecycle(paths: SwitchyPaths, changes: Partial<LifecyclePreferences>): Promise<void> {
  await withDirectoryLock(lifecycleFiles(paths).preferencesLock, async () => {
    const running = await getRunningProcess(paths);
    const preferences = { ...await readPreferences(paths), ...changes,
      ...(running ? { running: true, port: running.record.port } : {}) };

    const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
    if (!current || !await installHost(paths, path.join(paths.versions, current.version))) {
      throw new Error("Install a Switchy release with startup support first");
    }
    await setStartupRegistration(paths, preferences.startAtLogin);
    await writeJsonFileAtomic(lifecycleFiles(paths).preferences, preferences);
  });
  await startHost(paths);
}

export async function lifecycleTick(login = false): Promise<boolean> {
  const paths = getSwitchyPaths();
  const files = lifecycleFiles(paths);
  await ensureSwitchyDirectories(paths);
  return withDirectoryLock(paths.startLock, async () => {
    if (login && !(await readPreferences(paths)).startAtLogin) return false;
    if (login) {
      await withDirectoryLock(files.preferencesLock, async () => {
        const preferences = await readPreferences(paths);
        if (preferences.startAtLogin) {
          await writeJsonFileAtomic(files.preferences, { ...preferences, running: true });
        }
      });
    }
    const preferences = await readPreferences(paths);
    // Recover interrupted migrations even when the user subsequently stopped.
    await recoverInterruptedUpdate(paths);
    if (!preferences.running) return false;
    const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
    if (!current) return false;
    if (!await getRunningProcess(paths)) {
      await startSwitchyProcess({ paths, runtimeDirectory: path.join(paths.versions, current.version),
        version: current.version, port: preferences.port, foreground: false });
    }
    if (login && preferences.openAtLogin) {
      const { openCommand } = await import("./commands.js");
      await openCommand();
    }
    const request = await readJsonFile<{ action: "check" | "download" | "install" }>(files.request);

    const state = await readUpdateState(paths);
    const due = !state.lastCheckedAt || Date.now() - Date.parse(state.lastCheckedAt) >= 6 * 60 * 60_000;
    try {
      let latest = state.latestVersion;
      if (request?.action === "check" || (request && !latest) || (preferences.automaticUpdates && due)) {
        await saveUpdateState(paths, { phase: "checking", lastCheckedAt: new Date().toISOString(), message: null });
        latest = await resolveLatestStableVersion();
        if (request?.action === "check") await removeFile(files.request);
        await saveUpdateState(paths, { latestVersion: latest,
          phase: compareVersions(latest, current.version) > 0 ? "available" : "idle" });
      }
      if (request?.action === "download" && latest && compareVersions(latest, current.version) > 0) {
        await downloadUpdate(paths, latest);
        await removeFile(files.request);
        return true;
      }
      if (latest && compareVersions(latest, current.version) > 0
        && (request?.action === "install" || (preferences.automaticUpdates && state.failedVersion !== latest && (state.phase !== "failed" || due)))) {
        // New major versions require an explicit install action.
        if (request?.action === "install" || latest.split(".")[0] === current.version.split(".")[0]) {
          const installed = await installUpdate(paths, latest, request?.action === "install");
          if (installed && request) await removeFile(files.request);
        } else {
          await saveUpdateState(paths, { phase: "available", message: "A major update is available. Download it from System Info." });
        }
      }
      if (request && latest && compareVersions(latest, current.version) <= 0) await removeFile(files.request);
    } catch (error) {
      if (request) await removeFile(files.request);
      console.error("Switchy update check failed:", error);
      await saveUpdateState(paths, { phase: "failed", message: "Could not update Switchy. Your installed version is retained. Check the lifecycle log for details." });
    }
    return true;
  });
}
