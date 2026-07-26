import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const LOCK_TIMEOUT_MS = 60_000;
const INVALID_LOCK_GRACE_MS = 30_000;
const LOCK_OWNER_FILE = "owner.json";

interface LockOwner {
  pid: number;
  token: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLockOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8")
    ) as Partial<LockOwner>;
    if (
      !Number.isInteger(value.pid)
      || (value.pid ?? 0) <= 0
      || typeof value.token !== "string"
      || value.token.length === 0
    ) {
      return null;
    }
    return value as LockOwner;
  } catch {
    return null;
  }
}

async function removeOwnedLock(
  lockPath: string,
  token: string
): Promise<void> {
  const owner = await readLockOwner(lockPath);
  if (owner?.token === token) {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export async function removeFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export async function withDirectoryLock<T>(
  lockPath: string,
  operation: () => Promise<T>
): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const token = randomUUID();
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(
          path.join(lockPath, LOCK_OWNER_FILE),
          `${JSON.stringify({ pid: process.pid, token })}\n`,
          { mode: 0o600 }
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const [owner, lockStats] = await Promise.all([
        readLockOwner(lockPath),
        stat(lockPath).catch(() => null),
      ]);
      if (
        (owner && !processIsAlive(owner.pid))
        || (
          !owner
          && lockStats
          && Date.now() - lockStats.mtimeMs > INVALID_LOCK_GRACE_MS
        )
      ) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${path.basename(lockPath)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  try {
    return await operation();
  } finally {
    await removeOwnedLock(lockPath, token);
  }
}
