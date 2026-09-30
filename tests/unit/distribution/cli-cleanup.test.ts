import { existsSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RETAINED_UPDATE_SNAPSHOTS,
  pruneInstallArtifacts,
} from "../../../packages/cli/src/cleanup";
import { getSwitchyPaths } from "../../../packages/cli/src/paths";

const temporaryDirectories: string[] = [];

async function temporaryPaths() {
  const root = path.join(os.tmpdir(), `switchy-cli-cleanup-${crypto.randomUUID()}`);
  temporaryDirectories.push(root);
  const paths = getSwitchyPaths(root);
  for (const directory of [
    paths.versions,
    paths.downloads,
    paths.updateSnapshots,
  ]) {
    await mkdir(directory, { recursive: true });
  }
  return paths;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Switchy CLI install cleanup", () => {
  it("keeps only the active and previous runtimes and their archives", async () => {
    const paths = await temporaryPaths();
    for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.2.1-before-fix"]) {
      await mkdir(path.join(paths.versions, version));
    }
    await mkdir(path.join(paths.app, ".install-1.2.0-stale"));
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
      await writeFile(
        path.join(paths.downloads, `switchy-${version}-darwin-arm64.tar.gz`),
        "archive"
      );
    }

    const result = await pruneInstallArtifacts(paths, ["1.2.0", "1.1.0"]);

    expect(result.versions).toEqual(["1.0.0"]);
    expect(result.downloads).toEqual(["switchy-1.0.0-darwin-arm64.tar.gz"]);
    expect(existsSync(path.join(paths.versions, "1.1.0"))).toBe(true);
    expect(existsSync(path.join(paths.versions, "1.2.0"))).toBe(true);
    expect(existsSync(path.join(paths.versions, "1.2.1-before-fix"))).toBe(true);
    expect(existsSync(path.join(paths.app, ".install-1.2.0-stale"))).toBe(false);
  });

  it("keeps the newest update snapshots and never touches layout snapshots", async () => {
    const paths = await temporaryPaths();
    const snapshotCount = RETAINED_UPDATE_SNAPSHOTS + 2;
    for (let index = 0; index < snapshotCount; index += 1) {
      const snapshot = path.join(paths.updateSnapshots, `update-${index}`);
      await mkdir(snapshot);
      const modifiedAt = new Date(Date.UTC(2026, 0, index + 1));
      await utimes(snapshot, modifiedAt, modifiedAt);
    }
    await mkdir(path.join(paths.updateSnapshots, "layout-v1-2026"));

    const result = await pruneInstallArtifacts(paths, ["1.2.0", null]);

    expect(result.snapshots.sort()).toEqual(["update-0", "update-1"]);
    expect(existsSync(path.join(paths.updateSnapshots, "update-4"))).toBe(true);
    expect(existsSync(path.join(paths.updateSnapshots, "layout-v1-2026"))).toBe(true);
  });
});
