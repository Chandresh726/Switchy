import { randomUUID } from "node:crypto";
import { readdir, rename } from "node:fs/promises";
import path from "node:path";

import { reconcileRuntime } from "./controller.js";
import { readJsonFile, removeFile, withDirectoryLock, writeJsonFileAtomic } from "./files.js";
import type { LifecyclePreferences } from "./lifecycle-state.js";
import { compareVersions, lifecycleFiles, nextUpdateRequest, readPreferences, readUpdateState, saveUpdateState } from "./lifecycle-state.js";
import { ensureSwitchyDirectories, getSwitchyPaths } from "./paths.js";
import { setRunningPreference } from "./preferences.js";
import { getRunningProcess } from "./process-manager.js";
import { resolveLatestStableVersion } from "./release.js";
import { installHost, setStartupRegistration, startHost } from "./startup.js";
import type { CurrentVersionRecord, SwitchyPaths } from "./types.js";
import { downloadUpdate, installUpdate } from "./updater.js";

export async function configureLifecycle(paths: SwitchyPaths, changes: Partial<LifecyclePreferences>): Promise<void> {
  await withDirectoryLock(lifecycleFiles(paths).preferencesLock, async () => {
    const running = await getRunningProcess(paths);
    const preferences = { ...await readPreferences(paths), ...changes,
      ...(running ? { port: running.record.port } : {}) };

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
  if (login) {
    if (!(await readPreferences(paths)).startAtLogin) return false;
    await setRunningPreference(paths, true);
  }
  const record = await reconcileRuntime(paths);
  if (!record) return false;
  const preferences = await readPreferences(paths);
  const current = { version: record.version };
  if (login && preferences.openAtLogin) {
    const { openCommand } = await import("./open.js");
    await openCommand();
  }
  const queued = await nextUpdateRequest(paths);
  // Consume the legacy mailbox by renaming it first. A later writer cannot be
  // erased when this request is acknowledged.
  const legacy = queued ? null : await takeLegacyRequest(files.request);
  const request = queued?.request ?? legacy?.request ?? null;
  const acknowledge = async () => {
    const file = queued?.file ?? legacy?.file;
    if (file) await removeFile(file);
  };
  const state = await readUpdateState(paths);
  const due = !state.lastCheckedAt || Date.now() - Date.parse(state.lastCheckedAt) >= 6 * 60 * 60_000;
  try {
    let latest = request?.version ?? state.latestVersion;
    if (request?.action === "check" || (request && !latest) || (preferences.automaticUpdates && due && !request?.version)) {
      await saveUpdateState(paths, { phase: "checking", lastCheckedAt: new Date().toISOString(), message: null });
      latest = await resolveLatestStableVersion();
      await saveUpdateState(paths, { latestVersion: latest,
        phase: compareVersions(latest, current.version) > 0 ? "available" : "idle" });
      if (request?.action === "check") await acknowledge();
    }
    if (request?.action === "download" && latest && compareVersions(latest, current.version) > 0) {
      await downloadUpdate(paths, latest);
      await acknowledge();
      return true;
    }
    if (latest && compareVersions(latest, current.version) > 0
      && (request?.action === "install" || (preferences.automaticUpdates && state.failedVersion !== latest && (state.phase !== "failed" || due)))) {
      // New major versions require an explicit install action.
      if (request?.action === "install" || latest.split(".")[0] === current.version.split(".")[0]) {
        const installed = await installUpdate(paths, latest, request?.action === "install");
        if (installed && request) await acknowledge();
      } else {
        await saveUpdateState(paths, { phase: "available", message: "A major update is available. Download it from System Info." });
      }
    }
    if (request && latest && compareVersions(latest, current.version) <= 0) await acknowledge();
  } catch (error) {
    console.error("Switchy update check failed:", error);
    await saveUpdateState(paths, { phase: "failed", message: "Could not update Switchy. Check the lifecycle log for details." });
    if (request) await acknowledge();
  }
  return true;
}

async function takeLegacyRequest(file: string) {
  const pending = (await readdir(path.dirname(file))).filter((name) => name.startsWith(`${path.basename(file)}.`) && name.endsWith(".claimed")).sort()[0];
  if (pending) {
    const claimed = path.join(path.dirname(file), pending);
    return { file: claimed, request: await readJsonFile<{ action: "check" | "download" | "install"; version?: string }>(claimed) };
  }
  const claimed = `${file}.${randomUUID()}.claimed`;
  try { await rename(file, claimed); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return { file: claimed, request: await readJsonFile<{ action: "check" | "download" | "install"; version?: string }>(claimed) };
}
