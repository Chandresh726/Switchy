import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { getStateCoordinationDir } from "./paths";

const RUNTIME_LOCK_PREFIX = ".switchy-runtime-";
const RUNTIME_LOCK_SUFFIX = ".json";
const RESTORE_LOCK_DIRECTORY = "restore.lock";
const RESTORE_OWNER_FILE = "owner.json";
const registeredLocks = new Set<string>();

const processLockSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.iso.datetime(),
});

function runtimeLockPath(coordinationDirectory: string, pid: number): string {
  return path.join(
    coordinationDirectory,
    `${RUNTIME_LOCK_PREFIX}${pid}${RUNTIME_LOCK_SUFFIX}`
  );
}

function restoreLockPath(coordinationDirectory: string): string {
  return path.join(coordinationDirectory, RESTORE_LOCK_DIRECTORY);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readProcessLock(lockPath: string) {
  try {
    const contents = await readFile(lockPath, "utf8");
    return processLockSchema.safeParse(JSON.parse(contents) as unknown);
  } catch {
    return null;
  }
}

export function registerRuntimeLock(
  coordinationDirectory = getStateCoordinationDir()
): () => void {
  mkdirSync(coordinationDirectory, { recursive: true, mode: 0o700 });
  const exclusiveRestoreLock = restoreLockPath(coordinationDirectory);
  if (existsSync(exclusiveRestoreLock)) {
    throw new Error("Local state restore is in progress; application startup was stopped");
  }

  const lockPath = runtimeLockPath(coordinationDirectory, process.pid);
  if (!registeredLocks.has(lockPath)) {
    writeFileSync(
      lockPath,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      { mode: 0o600 }
    );
    if (existsSync(exclusiveRestoreLock)) {
      rmSync(lockPath, { force: true });
      throw new Error("Local state restore is in progress; application startup was stopped");
    }
    registeredLocks.add(lockPath);
    process.once("exit", () => {
      rmSync(lockPath, { force: true });
      registeredLocks.delete(lockPath);
    });
  }

  return () => {
    rmSync(lockPath, { force: true });
    registeredLocks.delete(lockPath);
  };
}

async function acquireExclusiveDirectory(coordinationDirectory: string): Promise<string> {
  const exclusiveRestoreLock = restoreLockPath(coordinationDirectory);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateDirectory = path.join(
      coordinationDirectory,
      `.restore-lock-candidate-${randomUUID()}`
    );
    await mkdir(candidateDirectory, { mode: 0o700 });
    try {
      await writeFile(
        path.join(candidateDirectory, RESTORE_OWNER_FILE),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        { mode: 0o600 }
      );
      await rename(candidateDirectory, exclusiveRestoreLock);
      return exclusiveRestoreLock;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;

      const existingOwner = await readProcessLock(
        path.join(exclusiveRestoreLock, RESTORE_OWNER_FILE)
      );
      if (existingOwner?.success && isProcessAlive(existingOwner.data.pid)) {
        throw new Error("Another local state restore is already in progress");
      }
      await rm(exclusiveRestoreLock, { recursive: true, force: true });
    } finally {
      await rm(candidateDirectory, { recursive: true, force: true });
    }
  }
  throw new Error("Unable to acquire the local state restore lock");
}

export async function acquireRestoreLock(
  coordinationDirectory: string
): Promise<() => Promise<void>> {
  await mkdir(coordinationDirectory, { recursive: true, mode: 0o700 });
  const exclusiveRestoreLock = await acquireExclusiveDirectory(coordinationDirectory);
  try {
    const entries = await readdir(coordinationDirectory);
    const runtimeLocks = entries.filter(
      (name) => name.startsWith(RUNTIME_LOCK_PREFIX) && name.endsWith(RUNTIME_LOCK_SUFFIX)
    );
    for (const lockName of runtimeLocks) {
      const lockPath = path.join(coordinationDirectory, lockName);
      const parsed = await readProcessLock(lockPath);
      if (!parsed?.success) {
        throw new Error(`Cannot verify application shutdown because ${lockName} is invalid`);
      }
      if (isProcessAlive(parsed.data.pid)) {
        throw new Error("Switchy is running. Stop the application before restoring local state");
      }
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    await rm(exclusiveRestoreLock, { recursive: true, force: true });
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rm(exclusiveRestoreLock, { recursive: true, force: true });
  };
}
