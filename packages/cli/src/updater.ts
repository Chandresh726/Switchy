import { constants } from "node:fs";
import { cp, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { pruneInstallArtifacts } from "./cleanup.js";
import { readJsonFile, removeFile, withDirectoryLock, writeJsonFileAtomic } from "./files.js";
import { syncDirectory, compareVersions, predatesCurrentBoot, lifecycleFiles, readPreferences, readUpdateState, saveUpdateState } from "./lifecycle-state.js";
import { fetchLiveness, getRunningProcess, startSwitchyProcess, stopSwitchy } from "./process-manager.js";
import { setRunningPreference } from "./preferences.js";
import { installRuntime, setCurrentVersion } from "./release.js";
import { createUpdateSnapshot, ensurePlaywrightBrowser, runDatabaseMigration, syncTree } from "./runtime.js";
import type { CurrentVersionRecord, SwitchyPaths } from "./types.js";
import type { UpdateTransaction } from "./lifecycle-state.js";
import { trackUpdateStage, updateProgressReporter } from "./update-progress.js";

async function appRequest(paths: SwitchyPaths, route: string, method = "GET"): Promise<Response> {
  const running = await getRunningProcess(paths);
  if (!running?.live || running.live.instanceId !== running.record.instanceId) {
    throw new Error("Cannot verify the running Switchy instance");
  }
  return fetch(`http://127.0.0.1:${running.record.port}/api/lifecycle/${route}`, {
    method, headers: { "X-Switchy-Request": "true" }, signal: AbortSignal.timeout(10_000),
  });
}

async function applicationIsIdle(paths: SwitchyPaths): Promise<boolean> {
  if (!await getRunningProcess(paths)) return true;
  const response = await appRequest(paths, "activity");
  if (response.status === 404) {
    throw new Error("This older Switchy version needs a one-time stopped upgrade. Run switchy stop, then switchy update.");
  }
  if (!response.ok) throw new Error("Could not check active Switchy work");
  const result = await response.json() as { idle?: unknown };
  return result.idle === true;
}

export async function browsersAreOpen(paths: SwitchyPaths): Promise<boolean> {
  const directory = lifecycleFiles(paths).browser;
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files) {
    const filePath = path.join(directory, file);
    const info = await stat(filePath).catch(() => null);
    if (info && Date.now() - info.mtimeMs < 90_000) return true;
    await rm(filePath, { force: true });
  }
  return false;
}

async function assertNoOtherRuntimes(paths: SwitchyPaths): Promise<void> {
  const directory = path.join(paths.runtime, "coordination");
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files.filter((name) => /^\.switchy-runtime-.*\.json$/u.test(name))) {
    const lock = await readJsonFile<{ pid: number; startedAt?: string }>(path.join(directory, file));
    if (!lock || !Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error("Cannot verify application shutdown");
    if (predatesCurrentBoot(lock.startedAt)) continue;
    try {
      process.kill(lock.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw error;
    }
    throw new Error("Another Switchy runtime is using local data");
  }
}

async function restoreSnapshot(paths: SwitchyPaths, transaction: UpdateTransaction): Promise<void> {
  if (!transaction.snapshot) throw new Error("Update recovery snapshot is missing");
  const expected = path.resolve(paths.updateSnapshots);
  const snapshot = path.resolve(transaction.snapshot);
  if (path.dirname(snapshot) !== expected) throw new Error("Invalid update recovery snapshot path");
  const original = path.join(snapshot, "production");
  if (!(await stat(original)).isDirectory()) throw new Error("Update recovery snapshot is missing");
  const staging = path.join(paths.data, ".update-restore");
  const failed = path.join(paths.data, ".update-failed");
  await rm(staging, { recursive: true, force: true });
  await cp(original, staging, { recursive: true, mode: constants.COPYFILE_FICLONE });
  await syncTree(staging);
  await rm(failed, { recursive: true, force: true });
  if (await stat(paths.productionData).catch(() => null)) await rename(paths.productionData, failed);
  await rename(staging, paths.productionData);
  await syncDirectory(paths.data);
  await rm(failed, { recursive: true, force: true });
}

// Must run under start.lock, before any server is started. The journal remains
// until commit, so power loss during migration or rollback is recoverable.
export async function recoverInterruptedUpdate(paths: SwitchyPaths): Promise<boolean> {
  return withDirectoryLock(path.join(paths.runtime, "migration.lock"), () => recoverUpdate(paths));
}

async function recoverUpdate(paths: SwitchyPaths): Promise<boolean> {
  const files = lifecycleFiles(paths);
  const transaction = await readJsonFile<UpdateTransaction>(files.transaction);
  if (!transaction) {
    await removeFile(files.maintenance);
    return false;
  }
  if ((transaction.fromVersion !== null && !/^\d+\.\d+\.\d+$/u.test(transaction.fromVersion))
    || !/^\d+\.\d+\.\d+$/u.test(transaction.toVersion)
    || !["prepared", "stopped", "snapshot", "starting", "committed"].includes(transaction.stage)) {
    throw new Error("Invalid update recovery record");
  }
  if (transaction.stage === "committed") {
    await saveUpdateState(paths, { phase: "idle", failedVersion: null, downloadedVersion: null, message: null });
    await removeFile(files.transaction);
    await removeFile(files.maintenance);
    return false;
  }
  const running = await getRunningProcess(paths);
  if (running) await stopSwitchy(paths);
  await assertNoOtherRuntimes(paths);
  if (transaction.stage === "snapshot" || transaction.stage === "starting") {
    if (transaction.snapshot) await restoreSnapshot(paths, transaction);
    else if (transaction.hadData === false) await rm(paths.productionData, { recursive: true, force: true });
    else throw new Error("Update recovery snapshot is missing");
  }
  if (transaction.fromVersion) await setCurrentVersion(paths, transaction.fromVersion, transaction.previousVersion ?? null);
  else await removeFile(paths.currentVersion);
  await saveUpdateState(paths, {
    phase: "failed", failedVersion: transaction.toVersion,
    message: "The update did not complete. Switchy restored the previous version.",
  });
  await removeFile(files.transaction);
  await removeFile(files.maintenance);
  return true;
}

export async function downloadUpdate(paths: SwitchyPaths, version: string): Promise<string> {
  return withUpdateLock(paths, () => prepareUpdate(paths, version));
}

async function prepareUpdate(paths: SwitchyPaths, version: string): Promise<string> {
  const staged = (await readUpdateState(paths)).downloadedVersion === version;
  const report = updateProgressReporter(paths);
  if (!staged) await saveUpdateState(paths, { phase: "downloading", message: null, progress: null, timings: {} });
  const directory = await installRuntime(version, paths, report);
  if (!(await stat(path.join(directory, "bin/lifecycle.cjs")).catch(() => null))?.isFile()) {
    throw new Error("The candidate runtime is missing lifecycle support");
  }
  const metadata = await readJsonFile<{ lifecycleProtocol?: number }>(path.join(directory, "switchy-runtime.json"));
  if (metadata?.lifecycleProtocol !== 2) throw new Error("This release does not support safe managed updates. Choose a current release.");
  // Download browser dependencies before interrupting the running version.
  if (!staged) {
    await trackUpdateStage("browser", report, () => ensurePlaywrightBrowser(directory, paths));
    await saveUpdateState(paths, { phase: "ready", downloadedVersion: version, message: null, progress: null });
  }
  return directory;
}

interface InstallOptions {
  port?: number;
  foreground?: boolean;
}

/** Owns both update serialization and the short exclusive data transition. */
export async function installUpdate(paths: SwitchyPaths, version: string, manual: boolean, options: InstallOptions = {}): Promise<boolean> {
  return withUpdateLock(paths, async () => {
    const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
    if (current && compareVersions(version, current.version) <= 0) return false;
    const preferences = await readPreferences(paths);
    if (!manual && !preferences.automaticUpdates) return false;
    // Prepare while the app is in use; only activation needs an idle app.
    const directory = await prepareUpdate(paths, version);
    if (!await applicationIsIdle(paths) || (!manual && await browsersAreOpen(paths))) {
      await saveUpdateState(paths, { phase: "waiting", message: "Waiting for active work to finish and Switchy tabs to close." });
      return false;
    }
    return withDirectoryLock(paths.startLock, async () => {
      await recoverInterruptedUpdate(paths);
      const selected = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
      if (selected && compareVersions(version, selected.version) <= 0) return false;
      const latestPreferences = await readPreferences(paths);
      if ((preferences.stopToken !== latestPreferences.stopToken || (preferences.running && !latestPreferences.running))
        || (!manual && (!latestPreferences.automaticUpdates || await browsersAreOpen(paths)))) return false;
      return activateRuntime(paths, directory, version, selected, options);
    });
  });
}

async function activateRuntime(paths: SwitchyPaths, directory: string, version: string, current: CurrentVersionRecord | null, options: InstallOptions): Promise<boolean> {
  const files = lifecycleFiles(paths);
  const report = updateProgressReporter(paths);
  await writeJsonFileAtomic(files.maintenance, { startedAt: new Date().toISOString() });
  try {
    if (!await applicationIsIdle(paths)) {
      await saveUpdateState(paths, { phase: "waiting", message: "Waiting for active work to finish." });
      return false;
    }
    const running = await getRunningProcess(paths);
    const transaction: UpdateTransaction = {
      fromVersion: current?.version ?? null, toVersion: version, snapshot: null,
      previousVersion: current?.previousVersion ?? null,
      hadData: (await stat(paths.productionData).catch(() => null))?.isDirectory() ?? false,
      port: options.port ?? running?.record.port ?? (await readPreferences(paths)).port, stage: "prepared",
    };
    await writeJsonFileAtomic(files.transaction, transaction);
    await saveUpdateState(paths, { phase: "installing", message: "Switchy is updating…" });
    if (running) await stopSwitchy(paths);
    await assertNoOtherRuntimes(paths);
    transaction.stage = "stopped";
    await writeJsonFileAtomic(files.transaction, transaction);
    if (transaction.hadData) {
      transaction.snapshot = await trackUpdateStage("snapshot", report, () => createUpdateSnapshot(paths, current?.version ?? "unmanaged", version));
      if (!transaction.snapshot) throw new Error("Cannot update without a recovery snapshot");
    }
    transaction.stage = "snapshot";
    await writeJsonFileAtomic(files.transaction, transaction);
    await trackUpdateStage("migrate", report, () => runDatabaseMigration(directory, paths));
    transaction.stage = "starting";
    await writeJsonFileAtomic(files.transaction, transaction);
    await trackUpdateStage("start", report, () => startSwitchyProcess({ paths, runtimeDirectory: directory, version, port: transaction.port,
      foreground: options.foreground ?? false, candidate: true }));
    const live = await getRunningProcess(paths);
    const identity = live && await fetchLiveness(live.record);
    if (!identity || identity.version !== version || identity.instanceId !== live?.record.instanceId) {
      throw new Error("Updated application identity did not match");
    }
    await setCurrentVersion(paths, version, current?.version ?? null);
    await setRunningPreference(paths, !options.foreground, transaction.port);
    transaction.stage = "committed";
    await writeJsonFileAtomic(files.transaction, transaction);
    await saveUpdateState(paths, { phase: "idle", failedVersion: null, downloadedVersion: null, message: null, progress: null });
    await removeFile(files.transaction);
    // The candidate and commit are durable. Reopen admission before slow pruning.
    await removeFile(files.maintenance);
    await trackUpdateStage("cleanup", report, () => pruneInstallArtifacts(paths, [version, current?.version ?? null])).catch((error: unknown) => {
      console.warn("Could not prune old update artifacts:", error);
    });
    await saveUpdateState(paths, { progress: null });
    return true;
  } catch (error) {
    await recoverInterruptedUpdate(paths);
    if (current && !await getRunningProcess(paths)) {
      await startSwitchyProcess({ paths, runtimeDirectory: path.join(paths.versions, current.version), version: current.version,
        port: options.port ?? (await readPreferences(paths)).port, foreground: false });
    }
    throw error;
  } finally {
    if (!await readJsonFile(files.transaction)) await removeFile(files.maintenance);
  }
}

async function withUpdateLock<T>(paths: SwitchyPaths, operation: () => Promise<T>): Promise<T> {
  return withDirectoryLock(lifecycleFiles(paths).updateLock, async () => {
    try { return await operation(); } catch (error) {
      await saveUpdateState(paths, { phase: "failed", message: "Could not update Switchy. Check the lifecycle log for details." })
        .catch((stateError: unknown) => console.error("Could not record update failure:", stateError));
      throw error;
    }
  });
}
