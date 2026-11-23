import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { syncDirectory } from "./atomic-file";
import { predatesCurrentBoot, processIsAlive } from "./process-identity";

export { processIsAlive } from "./process-identity";

const LOCK_TIMEOUT_MS = 60_000;
const INVALID_LOCK_GRACE_MS = 30_000;
const OWNER_FILE = /^owner(?:-[a-f0-9-]+)?\.json$/u;

interface LockOwner {
  pid: number;
  token: string;
  startedAt?: string | number;
}

export class LockBusyError extends Error {}

async function removeEmptyDirectory(directory: string): Promise<void> {
  await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
  });
}

async function reclaimStaleLock(lockPath: string): Promise<void> {
  const names = await readdir(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const lockStats = await stat(lockPath).catch(() => null);
  if (names.length === 0 && lockStats && Date.now() - lockStats.mtimeMs < INVALID_LOCK_GRACE_MS) return;
  for (const name of names) {
    if (!OWNER_FILE.test(name)) continue;
    const ownerPath = path.join(lockPath, name);
    const owner = await readFile(ownerPath, "utf8")
      .then((value) => JSON.parse(value) as LockOwner)
      .catch(() => null);
    const valid = owner && Number.isInteger(owner.pid) && owner.pid > 0;
    const stale = valid
      ? !processIsAlive(owner.pid) || predatesCurrentBoot(owner.startedAt)
      : lockStats && Date.now() - lockStats.mtimeMs > INVALID_LOCK_GRACE_MS;
    if (stale) await unlink(ownerPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  // Never recursively remove a published lock. A competing reclaimer may
  // already have acquired it; its unique owner file makes rmdir fail safely.
  await removeEmptyDirectory(lockPath);
}

export async function removeFile(filePath: string): Promise<void> {
  try { await unlink(filePath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await syncDirectory(path.dirname(filePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function withDirectoryLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  { timeoutMs = LOCK_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const ownerName = `owner-${token}.json`;
  const candidate = `${lockPath}.candidate-${token}`;
  await mkdir(candidate, { mode: 0o700 });
  let acquired = false;
  try {
    await writeFile(path.join(candidate, ownerName), JSON.stringify({
      pid: process.pid, token, startedAt: new Date().toISOString(),
    }), { mode: 0o600 });
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        // Publish a populated directory atomically, with no ownerless window.
        await rename(candidate, lockPath);
        acquired = true;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(code ?? "")) throw error;
        if (code === "EPERM" && !(await stat(lockPath).catch(() => null))) throw error;
        await reclaimStaleLock(lockPath);
        if (!(await stat(lockPath).catch(() => null))) continue;
        if (Date.now() >= deadline) throw new LockBusyError(`Timed out waiting for ${path.basename(lockPath)}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return await operation();
  } finally {
    if (acquired) {
      await unlink(path.join(lockPath, ownerName)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await removeEmptyDirectory(lockPath);
    } else {
      await rm(candidate, { recursive: true, force: true });
    }
  }
}
