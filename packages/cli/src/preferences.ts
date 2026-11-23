import { randomUUID } from "node:crypto";

import { withDirectoryLock, writeJsonFileAtomic } from "./files.js";
import { lifecycleFiles, readPreferences } from "./lifecycle-state.js";
import type { LifecyclePreferences } from "./lifecycle-state.js";
import type { SwitchyPaths } from "./types.js";

async function saveRuntimePreference(paths: SwitchyPaths, changes: Partial<LifecyclePreferences>): Promise<void> {
  await withDirectoryLock(lifecycleFiles(paths).preferencesLock, async () => {
    await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), ...changes });
  });
}

export async function setRunningPreference(paths: SwitchyPaths, running: boolean, port?: number): Promise<void> {
  await saveRuntimePreference(paths, { running, ...(port === undefined ? {} : { port }) });
}

export async function requestRuntimeStop(paths: SwitchyPaths): Promise<void> {
  await saveRuntimePreference(paths, { running: false, stopToken: randomUUID() });
}
