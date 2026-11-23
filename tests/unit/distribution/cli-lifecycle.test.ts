import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { writeJsonFileAtomic } from "../../../packages/cli/src/files";
import { lifecycleTick } from "../../../packages/cli/src/lifecycle-manager";
import { enqueueUpdateRequest, nextUpdateRequest, lifecycleFiles, readPreferences } from "../../../packages/cli/src/lifecycle-state";
import { ensureSwitchyDirectories, getSwitchyPaths } from "../../../packages/cli/src/paths";

const mocks = vi.hoisted(() => ({ start: vi.fn(), running: vi.fn(), latest: vi.fn(), update: vi.fn(), download: vi.fn(), recover: vi.fn() }));
vi.mock("../../../packages/cli/src/process-manager", () => ({ getRunningProcess: mocks.running, startSwitchyProcess: mocks.start }));
vi.mock("../../../packages/cli/src/release", () => ({ resolveLatestStableVersion: mocks.latest }));
vi.mock("../../../packages/cli/src/updater", () => ({ installUpdate: mocks.update, downloadUpdate: mocks.download, recoverInterruptedUpdate: mocks.recover }));
let root: string;
let paths: ReturnType<typeof getSwitchyPaths>;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.running.mockResolvedValue(null);
  mocks.start.mockResolvedValue({ version: "1.9.0", port: 6767 });
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-lifecycle-test-"));
  vi.stubEnv("SWITCHY_HOME", root);
  paths = getSwitchyPaths(root);
  await ensureSwitchyDirectories(paths);
  await mkdir(paths.productionData, { recursive: true });
  await writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version: "1.9.0" });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("starts the installed version offline without checking releases when automatic updates are off", async () => {
  await lifecycleTick();
  expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ version: "1.9.0" }));
  expect(mocks.latest).not.toHaveBeenCalled();
});

it("honors an explicit stop and only clears it on an opted-in login", async () => {
  await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), running: false });
  expect(await lifecycleTick()).toBe(false);
  expect(await lifecycleTick(true)).toBe(false);
  expect(mocks.start).not.toHaveBeenCalled();
  await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), running: false, startAtLogin: true });
  expect(await lifecycleTick(true)).toBe(true);
  expect((await readPreferences(paths)).running).toBe(true);
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("does not automatically install major releases", async () => {
  await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), automaticUpdates: true });
  mocks.latest.mockResolvedValue("2.0.0");
  await lifecycleTick();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("does not keep retrying a failed release automatically", async () => {
  await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), automaticUpdates: true });
  await writeJsonFileAtomic(lifecycleFiles(paths).state, { phase: "failed", latestVersion: "1.10.0", failedVersion: "1.10.0", lastCheckedAt: new Date().toISOString() });
  await lifecycleTick();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.latest).not.toHaveBeenCalled();
});

it("retains a manual installation request while work is busy without polling GitHub repeatedly", async () => {
  await writeJsonFileAtomic(lifecycleFiles(paths).request, { action: "install" });
  await writeJsonFileAtomic(lifecycleFiles(paths).state, { phase: "waiting", latestVersion: "1.10.0", lastCheckedAt: new Date().toISOString() });
  mocks.update.mockResolvedValue(false);
  await lifecycleTick();
  await lifecycleTick();
  expect(mocks.update).toHaveBeenCalledTimes(2);
  expect(mocks.latest).not.toHaveBeenCalled();
});

it("downloads a requested update without installing or restarting it", async () => {
  await writeJsonFileAtomic(lifecycleFiles(paths).preferences, { ...await readPreferences(paths), automaticUpdates: true });
  await writeJsonFileAtomic(lifecycleFiles(paths).request, { action: "download" });
  await writeJsonFileAtomic(lifecycleFiles(paths).state, { phase: "available", latestVersion: "1.10.0", lastCheckedAt: new Date().toISOString() });
  mocks.running.mockResolvedValue({ record: { version: "1.9.0", port: 6767 } });
  await lifecycleTick();
  expect(mocks.download).toHaveBeenCalledWith(paths, "1.10.0");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("acknowledges only the consumed request when another arrives during a check", async () => {
  await enqueueUpdateRequest(paths, "check");
  mocks.latest.mockImplementation(async () => {
    await enqueueUpdateRequest(paths, "install", "1.10.0");
    return "1.10.0";
  });
  await lifecycleTick();
  expect((await nextUpdateRequest(paths))?.request).toMatchObject({ action: "install", version: "1.10.0" });
  mocks.update.mockResolvedValue(true);
  await lifecycleTick();
  expect(mocks.update).toHaveBeenCalledWith(paths, "1.10.0", true);
  expect(await nextUpdateRequest(paths)).toBeNull();
});
