import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readJsonFile, writeJsonFileAtomic } from "../../../packages/cli/src/files";
import { compareVersions, lifecycleFiles, readPreferences } from "../../../packages/cli/src/lifecycle-state";
import { ensureSwitchyDirectories, getSwitchyPaths } from "../../../packages/cli/src/paths";
import { installHost, startupPlist } from "../../../packages/cli/src/startup";
import { browsersAreOpen, downloadUpdate, installUpdate, recoverInterruptedUpdate } from "../../../packages/cli/src/updater";

const processManager = vi.hoisted(() => ({
  getRunningProcess: vi.fn(), stopSwitchy: vi.fn(), startSwitchyProcess: vi.fn(), fetchLiveness: vi.fn(),
}));
vi.mock("../../../packages/cli/src/process-manager", () => processManager);
vi.mock("../../../packages/cli/src/release", () => ({
  installRuntime: vi.fn(async (_version, paths) => path.join(paths.versions, "1.1.0")),
  setCurrentVersion: vi.fn(async (paths, version) => writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version })),
}));
vi.mock("../../../packages/cli/src/runtime", async (original) => ({
  ...await original<typeof import("../../../packages/cli/src/runtime")>(),
  ensurePlaywrightBrowser: vi.fn(), runDatabaseMigration: vi.fn(),
}));

let root: string;
let paths: ReturnType<typeof getSwitchyPaths>;

beforeEach(async () => {
  vi.clearAllMocks();
  processManager.getRunningProcess.mockResolvedValue(null);
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-update-test-"));
  paths = getSwitchyPaths(root);
  await ensureSwitchyDirectories(paths);
  await mkdir(paths.productionData, { recursive: true });
  await mkdir(path.join(paths.versions, "1.1.0/bin"), { recursive: true });
  await writeFile(path.join(paths.versions, "1.1.0/bin/lifecycle.cjs"), "");
  await writeFile(path.join(paths.productionData, "switchy.db"), "before migration");
  await writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version: "1.0.0" });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe("Switchy lifecycle", () => {
  it("defaults to explicit opt-in and compares versions numerically", async () => {
    expect(await readPreferences(paths)).toMatchObject({ startAtLogin: false, automaticUpdates: false, consented: false });
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(() => compareVersions("../unsafe", "1.0.0")).toThrow();
  });

  it("uses persistent paths and escapes the startup item without a shell", () => {
    const plist = startupPlist(getSwitchyPaths(path.join(root, "a & b's home")));
    expect(plist).toContain("a &amp; b&apos;s home");
    expect(plist).toContain("app/host/node");
    expect(plist).not.toContain("npx");
    expect(plist).not.toContain("/bin/sh");
  });

  it("treats any fresh browser heartbeat as active", async () => {
    expect(await browsersAreOpen(paths)).toBe(false);
    await mkdir(lifecycleFiles(paths).browser, { recursive: true });
    await writeFile(path.join(lifecycleFiles(paths).browser, "tab"), "");
    expect(await browsersAreOpen(paths)).toBe(true);
    expect(await installUpdate(paths, "1.1.0", false)).toBe(false);
    expect(processManager.stopSwitchy).not.toHaveBeenCalled();
  });

  it("never installs an older or identical release", async () => {
    expect(await installUpdate(paths, "1.0.0", true)).toBe(false);
    expect(await installUpdate(paths, "0.9.9", true)).toBe(false);
  });

  it("fails closed when active work cannot be checked", async () => {
    processManager.getRunningProcess.mockResolvedValue({ record: { port: 6767, instanceId: "abc" }, live: { instanceId: "abc" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(installUpdate(paths, "1.1.0", true)).rejects.toThrow("Could not check");
    expect(processManager.stopSwitchy).not.toHaveBeenCalled();
  });

  it("restores both data and version after an interrupted migrated candidate", async () => {
    const snapshot = path.join(paths.updateSnapshots, "update-test");
    await mkdir(path.join(snapshot, "production"), { recursive: true });
    await writeFile(path.join(snapshot, "production/switchy.db"), "original database");
    await writeFile(path.join(paths.productionData, "switchy.db"), "incompatible migrated database");
    await writeJsonFileAtomic(lifecycleFiles(paths).transaction, {
      fromVersion: "1.0.0", toVersion: "1.1.0", snapshot, port: 6767, stage: "starting",
    });
    await writeJsonFileAtomic(lifecycleFiles(paths).maintenance, {});
    expect(await recoverInterruptedUpdate(paths)).toBe(true);
    expect(await readFile(path.join(paths.productionData, "switchy.db"), "utf8")).toBe("original database");
    expect(await readJsonFile(paths.currentVersion)).toMatchObject({ version: "1.0.0" });
    expect(await readJsonFile(lifecycleFiles(paths).state)).toMatchObject({ failedVersion: "1.1.0" });
    expect(await readJsonFile(lifecycleFiles(paths).transaction)).toBeNull();
  });

  it("preserves the gate and recovery record when the snapshot cannot be restored", async () => {
    await writeJsonFileAtomic(lifecycleFiles(paths).transaction, {
      fromVersion: "1.0.0", toVersion: "1.1.0", snapshot: "/invalid", stage: "starting",
    });
    await writeJsonFileAtomic(lifecycleFiles(paths).maintenance, {});
    await expect(recoverInterruptedUpdate(paths)).rejects.toThrow("Invalid update recovery");
    expect((await stat(lifecycleFiles(paths).maintenance)).isFile()).toBe(true);
    expect(await readJsonFile(lifecycleFiles(paths).transaction)).not.toBeNull();
  });

  it("keeps committed data after power loss between commit and cleanup", async () => {
    await writeFile(path.join(paths.productionData, "switchy.db"), "committed database");
    await writeJsonFileAtomic(lifecycleFiles(paths).transaction, {
      fromVersion: "1.0.0", toVersion: "1.1.0", stage: "committed", snapshot: null,
    });
    await writeJsonFileAtomic(lifecycleFiles(paths).maintenance, {});
    await recoverInterruptedUpdate(paths);
    expect(await readFile(path.join(paths.productionData, "switchy.db"), "utf8")).toBe("committed database");
    expect(processManager.stopSwitchy).not.toHaveBeenCalled();
  });
});

it("restores the previous database and restarts the previous runtime after migration failure", async () => {
  const { runDatabaseMigration } = await import("../../../packages/cli/src/runtime");
  vi.mocked(runDatabaseMigration).mockImplementationOnce(async () => {
    await writeFile(path.join(paths.productionData, "switchy.db"), "broken schema");
    throw new Error("migration failed");
  });
  await expect(installUpdate(paths, "1.1.0", true)).rejects.toThrow("migration failed");
  expect(await readFile(path.join(paths.productionData, "switchy.db"), "utf8")).toBe("before migration");
  expect(processManager.startSwitchyProcess).toHaveBeenCalledWith(expect.objectContaining({ version: "1.0.0" }));
  expect(await readJsonFile(lifecycleFiles(paths).transaction)).toBeNull();
  expect(await readJsonFile(lifecycleFiles(paths).state)).toMatchObject({ failedVersion: "1.1.0" });
});

it("closes admission before migration and commits before allowing new writes", async () => {
  const { runDatabaseMigration } = await import("../../../packages/cli/src/runtime");
  vi.mocked(runDatabaseMigration).mockImplementationOnce(async () => {
    expect(await readJsonFile(lifecycleFiles(paths).maintenance)).not.toBeNull();
    expect(await readJsonFile(paths.currentVersion)).toMatchObject({ version: "1.0.0" });
    await writeFile(path.join(paths.productionData, "switchy.db"), "new schema");
  });
  processManager.startSwitchyProcess.mockImplementationOnce(async () => {
    expect(await readJsonFile(lifecycleFiles(paths).maintenance)).not.toBeNull();
    processManager.getRunningProcess.mockResolvedValue({ record: { instanceId: "candidate" } });
  });
  processManager.fetchLiveness.mockResolvedValue({ version: "1.1.0", instanceId: "candidate" });
  expect(await installUpdate(paths, "1.1.0", true)).toBe(true);
  expect(await readJsonFile(paths.currentVersion)).toMatchObject({ version: "1.1.0" });
  expect(await readJsonFile(lifecycleFiles(paths).maintenance)).toBeNull();
  expect(await readJsonFile(lifecycleFiles(paths).transaction)).toBeNull();
  expect(await readFile(path.join(paths.productionData, "switchy.db"), "utf8")).toBe("new schema");
});

it("packages a syntactically valid supervisor without relying on the CLI installation", async () => {
  const host = lifecycleFiles(paths).host;
  await mkdir(host, { recursive: true });
  await writeFile(path.join(host, process.platform === "win32" ? "node.exe" : "node"), "fixture");
  expect(await installHost(paths, path.join(paths.versions, "1.1.0"))).toBe(true);
  const supervisor = await readFile(path.join(host, "supervisor.cjs"), "utf8");
  expect(() => new Script(supervisor)).not.toThrow();
  expect(supervisor).toContain("bin/lifecycle.cjs");
});

it("stages downloads without stopping the app or changing the selected version", async () => {
  await downloadUpdate(paths, "1.1.0");
  expect(processManager.stopSwitchy).not.toHaveBeenCalled();
  expect(processManager.startSwitchyProcess).not.toHaveBeenCalled();
  expect(await readJsonFile(paths.currentVersion)).toMatchObject({ version: "1.0.0" });
  expect(await readJsonFile(lifecycleFiles(paths).state)).toMatchObject({ phase: "ready", downloadedVersion: "1.1.0" });
});
