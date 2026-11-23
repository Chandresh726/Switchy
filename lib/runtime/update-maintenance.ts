import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getSwitchyRootDirectory } from "@/lib/state/layout";

function runtimeFile(name: string): string {
  return path.join(getSwitchyRootDirectory(), "runtime", name);
}

export function isUpdateMaintenance(): boolean {
  return process.env.NODE_ENV === "production" && existsSync(runtimeFile("update-maintenance.json"));
}

export function recordMutationActivity(): void {
  if (process.env.NODE_ENV !== "production") return;
  const file = runtimeFile("last-mutation");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, "", { mode: 0o600 });
}

export function hasRecentMutation(): boolean {
  try {
    return Date.now() - statSync(runtimeFile("last-mutation")).mtimeMs < 60_000;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
