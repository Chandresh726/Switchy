import type { Dirent } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { SwitchyPaths } from "./types.js";

const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const DOWNLOAD_ARCHIVE_PATTERN =
  /^switchy-(\d+\.\d+\.\d+)-(?:darwin|linux|win32)-(?:arm64|x64)\.tar\.gz$/u;
const INSTALL_DIRECTORY_PREFIX = ".install-";
const UPDATE_SNAPSHOT_PREFIX = "update-";
export const RETAINED_UPDATE_SNAPSHOTS = 3;

export interface PruneResult {
  versions: string[];
  downloads: string[];
  snapshots: string[];
}

async function listEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Removes runtimes, cached archives, and update snapshots that are no longer
 * needed. Callers must hold the start lock so no install or process is using
 * the versions being removed.
 */
export async function pruneInstallArtifacts(
  paths: SwitchyPaths,
  retainedVersions: Array<string | null>
): Promise<PruneResult> {
  const retained = new Set(
    retainedVersions.filter((version): version is string => Boolean(version))
  );
  const result: PruneResult = { versions: [], downloads: [], snapshots: [] };

  for (const entry of await listEntries(paths.versions)) {
    if (
      !entry.isDirectory()
      || !STABLE_VERSION_PATTERN.test(entry.name)
      || retained.has(entry.name)
    ) {
      continue;
    }
    await rm(path.join(paths.versions, entry.name), {
      recursive: true,
      force: true,
    });
    result.versions.push(entry.name);
  }

  for (const entry of await listEntries(paths.app)) {
    if (entry.isDirectory() && entry.name.startsWith(INSTALL_DIRECTORY_PREFIX)) {
      await rm(path.join(paths.app, entry.name), { recursive: true, force: true });
    }
  }

  for (const entry of await listEntries(paths.downloads)) {
    const version = DOWNLOAD_ARCHIVE_PATTERN.exec(entry.name)?.[1];
    if (!entry.isFile() || !version || retained.has(version)) continue;
    await rm(path.join(paths.downloads, entry.name), { force: true });
    result.downloads.push(entry.name);
  }

  const snapshots = await Promise.all(
    (await listEntries(paths.updateSnapshots))
      .filter((entry) =>
        entry.isDirectory() && entry.name.startsWith(UPDATE_SNAPSHOT_PREFIX)
      )
      .map(async (entry) => ({
        name: entry.name,
        modifiedAt: (await stat(path.join(paths.updateSnapshots, entry.name)))
          .mtimeMs,
      }))
  );
  snapshots.sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const snapshot of snapshots.slice(RETAINED_UPDATE_SNAPSHOTS)) {
    await rm(path.join(paths.updateSnapshots, snapshot.name), {
      recursive: true,
      force: true,
    });
    result.snapshots.push(snapshot.name);
  }

  return result;
}
