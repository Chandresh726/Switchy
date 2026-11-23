import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";

import { LockBusyError, readJsonFile, withDirectoryLock } from "./files.js";
import { lifecycleTick } from "./lifecycle-manager.js";
import { lifecycleFiles } from "./lifecycle-state.js";
import { ensureSwitchyDirectories, getSwitchyPaths } from "./paths.js";
import { rotateLog } from "./logs.js";
import type { CurrentVersionRecord } from "./types.js";

export async function serveLifecycle(login: boolean): Promise<20 | 21> {
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  const files = lifecycleFiles(paths);
  await mkdir(files.requests, { recursive: true, mode: 0o700 });
  try {
    return await withDirectoryLock(files.supervisorLock, async () => {
      const initial = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
      let stopping = false;
      let dirty = false;
      let wake: (() => void) | undefined;
      const notify = () => { dirty = true; wake?.(); };
      const stop = () => { stopping = true; notify(); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const watchers = [watch(paths.runtime, (_, name) => {
        if (["lifecycle.json", "update-request.json", "update-requests", "process.json"].includes(String(name))) notify();
      }), watch(files.requests, notify)];
      // Watchers are a latency optimization. The timer also recovers from
      // missed filesystem events and notices an unexpected application exit.
      for (const watcher of watchers) watcher.on("error", (error) => console.warn("Switchy lifecycle watch:", error.message));
      try {
        let lastError: string | null = null;
        while (!stopping) {
          try {
            if (!await lifecycleTick(login)) return 20;
            login = false;
            lastError = null;
            await rotateLog(paths.logFile);
            await rotateLog(`${paths.logs}/lifecycle.log`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== lastError) console.error("Switchy lifecycle:", message);
            lastError = message;
          }
          const current = await readJsonFile<CurrentVersionRecord>(paths.currentVersion);
          if (!current) return 20;
          if (current.version !== initial?.version) return 21;
          const node = await readJsonFile<{ version: string }>(`${files.host}/node.json`);
          if (node && node.version !== process.versions.node) return 21;
          if (!dirty && !stopping) await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 30_000);
            wake = () => { clearTimeout(timer); resolve(); };
          });
          wake = undefined;
          dirty = false;
        }
        return 20;
      } finally {
        for (const watcher of watchers) watcher.close();
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    }, { timeoutMs: 0 });
  } catch (error) {
    if (error instanceof LockBusyError) return 20;
    throw error;
  }
}
