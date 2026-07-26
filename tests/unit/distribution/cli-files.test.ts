import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withDirectoryLock } from "../../../packages/cli/src/files";
import { getSwitchyPaths } from "../../../packages/cli/src/paths";
import { getRunningProcess } from "../../../packages/cli/src/process-manager";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = path.join(
    os.tmpdir(),
    `switchy-cli-files-${crypto.randomUUID()}`
  );
  await mkdir(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Switchy CLI local coordination", () => {
  it("serializes operations without treating a long-lived owner as stale", async () => {
    const root = await temporaryDirectory();
    const lockPath = path.join(root, "operation.lock");
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withDirectoryLock(lockPath, async () => {
      events.push("first-start");
      await firstCanFinish;
      events.push("first-end");
    });
    await expect.poll(
      () => existsSync(path.join(lockPath, "owner.json"))
    ).toBe(true);

    const second = withDirectoryLock(lockPath, async () => {
      events.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("reclaims a lock whose recorded process is no longer alive", async () => {
    const root = await temporaryDirectory();
    const lockPath = path.join(root, "operation.lock");
    mkdirSync(lockPath);
    writeFileSync(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: 2_147_483_647, token: "stale" })
    );

    await expect(
      withDirectoryLock(lockPath, async () => "complete")
    ).resolves.toBe("complete");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("discards corrupt transient process metadata", async () => {
    const root = await temporaryDirectory();
    const paths = getSwitchyPaths(root);
    mkdirSync(paths.runtime, { recursive: true });
    writeFileSync(paths.processRecord, "{invalid");

    await expect(getRunningProcess(paths)).resolves.toBeNull();
    expect(existsSync(paths.processRecord)).toBe(false);
  });
});
