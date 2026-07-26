import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import {
  CLI_VERSION,
  DEFAULT_PORT,
  resolveApplicationVersion,
} from "./config.js";
import {
  readJsonFile,
  withDirectoryLock,
} from "./files.js";
import {
  fetchLiveness,
  getRunningProcess,
  startSwitchyProcess,
  stopSwitchy,
} from "./process-manager.js";
import {
  ensureSwitchyDirectories,
  getSwitchyPaths,
} from "./paths.js";
import {
  installRuntime,
  resolveLatestStableVersion,
  setCurrentVersion,
} from "./release.js";
import {
  createUpdateSnapshot,
  ensurePlaywrightBrowser,
  runDatabaseMigration,
} from "./runtime.js";
import type { CurrentVersionRecord } from "./types.js";

async function installedVersion(): Promise<string | null> {
  const paths = getSwitchyPaths();
  const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
  return current?.schemaVersion === 1 ? current.version : null;
}

export async function startCommand({
  version,
  port = DEFAULT_PORT,
  foreground = false,
}: {
  version?: string;
  port?: number;
  foreground?: boolean;
} = {}): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  await withDirectoryLock(paths.startLock, () =>
    startCommandUnlocked({ paths, version, port, foreground })
  );
}

async function startCommandUnlocked({
  paths,
  version,
  port,
  foreground,
}: {
  paths: ReturnType<typeof getSwitchyPaths>;
  version?: string;
  port: number;
  foreground: boolean;
}): Promise<void> {
  const existing = await getRunningProcess(paths);
  if (existing) {
    console.log(
      `Switchy ${existing.record.version} is already running at `
      + `http://${existing.record.hostname}:${existing.record.port}`
    );
    return;
  }

  const selectedVersion = resolveApplicationVersion(version);
  const runtimeDirectory = await installRuntime(selectedVersion, paths);
  await ensurePlaywrightBrowser(runtimeDirectory, paths);
  await runDatabaseMigration(runtimeDirectory, paths);
  await setCurrentVersion(paths, selectedVersion);
  const record = await startSwitchyProcess({
    paths,
    runtimeDirectory,
    version: selectedVersion,
    port,
    foreground,
  });
  if (!foreground) {
    console.log(
      `Switchy ${selectedVersion} is running at `
      + `http://${record.hostname}:${record.port}`
    );
  }
}

export async function stopCommand(force = false): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  await withDirectoryLock(paths.startLock, async () => {
    if (await stopSwitchy(paths, force)) console.log("Switchy stopped.");
    else console.log("Switchy is not running.");
  });
}

export async function statusCommand(): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  const running = await getRunningProcess(paths);
  if (!running) {
    console.log("Switchy is stopped.");
    return;
  }
  const live = running.live ?? await fetchLiveness(running.record);
  console.log(`Switchy ${running.record.version} is running.`);
  console.log(`URL: http://${running.record.hostname}:${running.record.port}`);
  console.log(`PID: ${running.record.pid}`);
  console.log(`Health: ${live ? "Live" : "Starting or unavailable"}`);
}

export async function updateCommand(): Promise<void> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  await withDirectoryLock(paths.startLock, async () => {
    const latestVersion = await resolveLatestStableVersion();
    const currentVersion = await installedVersion();
    if (currentVersion === latestVersion) {
      console.log(`Switchy ${latestVersion} is already current.`);
      return;
    }

    const wasRunning = await getRunningProcess(paths);
    await installRuntime(latestVersion, paths);
    if (wasRunning) await stopSwitchy(paths);
    const snapshot = currentVersion
      ? await createUpdateSnapshot(paths, currentVersion, latestVersion)
      : null;
    try {
      await startCommandUnlocked({
        paths,
        version: latestVersion,
        port: wasRunning?.record.port ?? DEFAULT_PORT,
        foreground: false,
      });
    } catch (error) {
      if (snapshot) {
        console.error(`Update snapshot retained at ${snapshot}`);
      }
      throw error;
    }
  });
}

export async function logsCommand(): Promise<void> {
  const paths = getSwitchyPaths();
  const contents = await readFile(paths.logFile, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  const lines = contents.trimEnd().split("\n");
  console.log(lines.slice(-200).join("\n"));
}

export async function openCommand(): Promise<void> {
  const paths = getSwitchyPaths();
  const running = await getRunningProcess(paths);
  if (!running) throw new Error("Switchy is not running");
  const url = `http://${running.record.hostname}:${running.record.port}`;
  let executable: string;
  let args: string[];
  if (process.platform === "darwin") {
    executable = "open";
    args = [url];
  } else if (process.platform === "win32") {
    executable = "cmd";
    args = ["/c", "start", "", url];
  } else {
    executable = "xdg-open";
    args = [url];
  }
  const child = spawn(executable, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(url);
}

export function versionCommand(): void {
  console.log(CLI_VERSION);
}
