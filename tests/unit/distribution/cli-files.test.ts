import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
      async () => (await readdir(lockPath).catch(() => [])).some((name) => /^owner-/.test(name))
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

  it("ignores corrupt process metadata without mutating it during inspection", async () => {
    const root = await temporaryDirectory();
    const paths = getSwitchyPaths(root);
    mkdirSync(paths.runtime, { recursive: true });
    writeFileSync(paths.processRecord, "{invalid");

    await expect(getRunningProcess(paths)).resolves.toBeNull();
    expect(existsSync(paths.processRecord)).toBe(true);
  });
});

it("keeps simultaneous stale-lock reclaimers mutually exclusive", async () => {
  const root = await temporaryDirectory();
  const lock = path.join(root, "stale.lock");
  await mkdir(lock);
  writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "old" }));
  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 8 }, () => withDirectoryLock(lock, async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  })));
  expect(maximum).toBe(1);
  expect(existsSync(lock)).toBe(false);
});

it("ignores a reused PID recorded before this boot without probing or killing it", async () => {
  const root = await temporaryDirectory();
  const paths = getSwitchyPaths(root);
  await mkdir(paths.runtime);
  writeFileSync(paths.processRecord, JSON.stringify({
    schemaVersion: 1, pid: process.pid, instanceId: "previous-boot", version: "1.0.0",
    hostname: "127.0.0.1", port: 6767, startedAt: "1970-01-01T00:00:00.000Z",
  }));
  const fetch = vi.spyOn(globalThis, "fetch");
  const uptime = vi.spyOn(os, "uptime").mockReturnValue(60);
  try {
    expect(await getRunningProcess(paths)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); uptime.mockRestore(); }
});
