import { cp, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { pruneInstallArtifacts } from "./cleanup.js";
import { readJsonFile, removeFile, writeJsonFileAtomic } from "./files.js";
import { compareVersions, predatesCurrentBoot, lifecycleFiles, readPreferences, readUpdateState, saveUpdateState } from "./lifecycle-state.js";
import { fetchLiveness, getRunningProcess, startSwitchyProcess, stopSwitchy } from "./process-manager.js";
import { installRuntime, setCurrentVersion } from "./release.js";
import { createUpdateSnapshot, ensurePlaywrightBrowser, runDatabaseMigration } from "./runtime.js";
import type { CurrentVersionRecord, SwitchyPaths } from "./types.js";
import type { UpdateTransaction } from "./lifecycle-state.js";

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
  await cp(original, staging, { recursive: true });
  await rm(failed, { recursive: true, force: true });
  if (await stat(paths.productionData).catch(() => null)) await rename(paths.productionData, failed);
  await rename(staging, paths.productionData);
  await rm(failed, { recursive: true, force: true });
}

// Must run under start.lock, before any server is started. The journal remains
// until commit, so power loss during migration or rollback is recoverable.
export async function recoverInterruptedUpdate(paths: SwitchyPaths): Promise<boolean> {
  const files = lifecycleFiles(paths);
  const transaction = await readJsonFile<UpdateTransaction>(files.transaction);
  if (!transaction) {
    await removeFile(files.maintenance);
    return false;
  }
  if (transaction.stage === "committed") {
    await removeFile(files.transaction);
    await removeFile(files.maintenance);
    return false;
  }
  if (!/^\d+\.\d+\.\d+$/u.test(transaction.fromVersion) || !/^\d+\.\d+\.\d+$/u.test(transaction.toVersion)) {
    throw new Error("Invalid update recovery record");
  }
  const running = await getRunningProcess(paths);
  if (running) await stopSwitchy(paths);
  await assertNoOtherRuntimes(paths);
  if (transaction.stage === "snapshot" || transaction.stage === "starting") {
    await restoreSnapshot(paths, transaction);
  }
  await setCurrentVersion(paths, transaction.fromVersion);
  await saveUpdateState(paths, {
    phase: "failed", failedVersion: transaction.toVersion,
    message: "The update did not complete. Switchy restored the previous version.",
  });
  await removeFile(files.transaction);
  await removeFile(files.maintenance);
  return true;
}

export async function downloadUpdate(paths: SwitchyPaths, version: string): Promise<string> {
  const staged = (await readUpdateState(paths)).downloadedVersion === version;
  if (!staged) await saveUpdateState(paths, { phase: "downloading", message: null });
  const directory = await installRuntime(version, paths);
  if (!(await stat(path.join(directory, "bin/lifecycle.cjs")).catch(() => null))?.isFile()) {
    throw new Error("The candidate runtime is missing lifecycle support");
  }
  // Download browser dependencies before interrupting the running version.
  if (!staged) {
    await ensurePlaywrightBrowser(directory, paths);
    await saveUpdateState(paths, { phase: "ready", downloadedVersion: version, message: null });
  }
  return directory;
}

export async function installUpdate(paths: SwitchyPaths, version: string, manual: boolean): Promise<boolean> {
  const files = lifecycleFiles(paths);
  const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
  if (!current || compareVersions(version, current.version) <= 0) return false;
  if (!await applicationIsIdle(paths) || (!manual && await browsersAreOpen(paths))) {
    await saveUpdateState(paths, { phase: "waiting", message: "Waiting for active work to finish and Switchy tabs to close." });
    return false;
  }
  const directory = await downloadUpdate(paths, version);
  if (!manual && (!(await readPreferences(paths)).automaticUpdates || await browsersAreOpen(paths))) return false;
  await writeJsonFileAtomic(files.maintenance, { startedAt: new Date().toISOString() });
  try {
    // The maintenance flag prevents new requests, scheduled batches and claims.
    // Recheck after admission has closed to cover work racing the first check.
    if (!await applicationIsIdle(paths)) {
      await saveUpdateState(paths, { phase: "waiting", message: "Waiting for active work to finish." });
      return false;
    }
    const running = await getRunningProcess(paths);
    const transaction: UpdateTransaction = {
      fromVersion: current.version, toVersion: version, snapshot: null,
      port: running?.record.port ?? (await readPreferences(paths)).port, stage: "prepared",
    };
    await writeJsonFileAtomic(files.transaction, transaction);
    await saveUpdateState(paths, { phase: "installing", message: "Switchy is updating…" });
    if (running) await stopSwitchy(paths);
    await assertNoOtherRuntimes(paths);
    transaction.stage = "stopped";
    await writeJsonFileAtomic(files.transaction, transaction);
    transaction.snapshot = await createUpdateSnapshot(paths, current.version, version);
    if (!transaction.snapshot) throw new Error("Cannot update without a recovery snapshot");
    transaction.stage = "snapshot";
    await writeJsonFileAtomic(files.transaction, transaction);
    await runDatabaseMigration(directory, paths);
    transaction.stage = "starting";
    await writeJsonFileAtomic(files.transaction, transaction);
    await startSwitchyProcess({ paths, runtimeDirectory: directory, version, port: transaction.port, foreground: false });
    const live = await getRunningProcess(paths);
    const identity = live && await fetchLiveness(live.record);
    if (!identity || identity.version !== version || identity.instanceId !== live?.record.instanceId) {
      throw new Error("Updated application identity did not match");
    }
    // Commit before opening admission. No user or background writes can occur
    // on the candidate database before this point.
    await setCurrentVersion(paths, version);
    transaction.stage = "committed";
    await writeJsonFileAtomic(files.transaction, transaction);
    await removeFile(files.transaction);
    await saveUpdateState(paths, { phase: "idle", failedVersion: null, downloadedVersion: null, message: null });
    await pruneInstallArtifacts(paths, [version, current.version]).catch((error: unknown) => {
      console.warn("Could not prune old update artifacts:", error);
    });
    return true;
  } catch (error) {
    await recoverInterruptedUpdate(paths);
    const previous = path.join(paths.versions, current.version);
    if (!await getRunningProcess(paths)) {
      await startSwitchyProcess({ paths, runtimeDirectory: previous, version: current.version,
        port: (await readJsonFile<{ port: number }>(files.preferences))?.port ?? 6767, foreground: false });
    }
    throw error;
  } finally {
    // Keep admission closed when recovery itself failed.
    if (!await readJsonFile(files.transaction)) await removeFile(files.maintenance);
  }
}
