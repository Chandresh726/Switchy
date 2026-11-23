import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { writeJsonFileAtomic } from "../../../packages/cli/src/files";
import { serveLifecycle } from "../../../packages/cli/src/lifecycle-daemon";
import { ensureSwitchyDirectories, getSwitchyPaths } from "../../../packages/cli/src/paths";
import { lifecycleFiles, readPreferences } from "../../../packages/cli/src/lifecycle-state";

const mocks = vi.hoisted(() => ({ tick: vi.fn(), notifications: [] as Array<() => void> }));
vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  watch: (_directory: string, listener: (event: string, name: string) => void) => {
    mocks.notifications.push(() => listener("change", "lifecycle.json"));
    return { on: vi.fn(), close: vi.fn() };
  },
}));
vi.mock("../../../packages/cli/src/lifecycle-manager", () => ({ lifecycleTick: mocks.tick }));
let root: string;
afterEach(async () => { vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); });

it("keeps one manager owner and wakes an existing worker for preference changes", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-daemon-"));
  vi.stubEnv("SWITCHY_HOME", root);
  const paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  await writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version: "1.0.0" });
  let entered!: () => void;
  let finish!: (value: boolean) => void;
  const active = new Promise<void>((resolve) => { entered = resolve; });
  const firstTick = new Promise<boolean>((resolve) => { finish = resolve; });
  mocks.tick.mockImplementationOnce(() => { entered(); return firstTick; }).mockResolvedValue(false);
  const serving = serveLifecycle(false);
  await active;
  try {
    expect(await serveLifecycle(false)).toBe(20);
    expect(mocks.tick).toHaveBeenCalledOnce();
    await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), running: false });
    mocks.notifications[0]();
  } finally { finish(true); }
  expect(await serving).toBe(20);
  expect(mocks.tick).toHaveBeenCalledTimes(2);
});
