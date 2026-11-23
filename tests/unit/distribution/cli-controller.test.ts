import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { doctorCommand, startCommand, stopCommand } from "../../../packages/cli/src/commands";
import { startRuntime } from "../../../packages/cli/src/controller";
import { writeJsonFileAtomic } from "../../../packages/cli/src/files";
import { ensureSwitchyDirectories, getSwitchyPaths } from "../../../packages/cli/src/paths";
import { parseArguments } from "../../../packages/cli/src/arguments";

const mocks = vi.hoisted(() => ({ running: vi.fn(), start: vi.fn(), stop: vi.fn(), install: vi.fn(), wait: vi.fn() }));
vi.mock("../../../packages/cli/src/process-manager", () => ({
  readProcessRecord: async () => null, getRunningProcess: mocks.running, startSwitchyProcess: mocks.start, stopSwitchy: mocks.stop, waitForForegroundExit: mocks.wait,
}));
vi.mock("../../../packages/cli/src/updater", () => ({ installUpdate: mocks.install, recoverInterruptedUpdate: async () => false }));
vi.mock("../../../packages/cli/src/lifecycle", () => ({ prepareLifecycleHost: async () => undefined }));
let root: string;
let paths: ReturnType<typeof getSwitchyPaths>;
const record = { schemaVersion: 1, pid: 123, instanceId: "test", version: "1.1.0", port: 6767, hostname: "127.0.0.1", startedAt: new Date().toISOString() };
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-controller-"));
  vi.stubEnv("SWITCHY_HOME", root);
  paths = getSwitchyPaths();
  await ensureSwitchyDirectories(paths);
  await writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version: "1.1.0", previousVersion: "1.0.0" });
  mocks.start.mockResolvedValue(record);
  mocks.running.mockResolvedValue(null);
  mocks.stop.mockResolvedValue(true);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it("sends every explicit version change through the protected updater", async () => {
  mocks.install.mockResolvedValue(false);
  await expect(startRuntime(paths, { version: "1.2.0" })).rejects.toThrow("Version change deferred");
  expect(mocks.install).toHaveBeenCalledWith(paths, "1.2.0", true, expect.objectContaining({ port: 6767 }));
  expect(mocks.start).not.toHaveBeenCalled();
});

it("retains the previous successful runtime through an ordinary start", async () => {
  for (const version of ["1.0.0", "1.1.0"]) await mkdir(path.join(paths.versions, version));
  await startRuntime(paths);
  expect(await readdir(paths.versions)).toEqual(["1.0.0", "1.1.0"]);
});

it("allows stop while the foreground command waits for application exit", async () => {
  let ready!: () => void;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { ready = resolve; });
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  mocks.wait.mockImplementation(async () => { ready(); await completion; });
  const foreground = startCommand({ foreground: true });
  await waiting;
  try {
    await stopCommand();
    expect(mocks.stop).toHaveBeenCalledWith(paths, false);
  } finally { finish(); await foreground; }
});

it("rejects misspelled options and conflicting update actions before any work starts", () => {
  expect(() => parseArguments(["constructor"])).toThrow("Unknown command");
  expect(() => parseArguments(["start", "constructor"])).toThrow("Unknown option");
  expect(() => parseArguments(["start", "--forground"])).toThrow("Unknown option");
  expect(() => parseArguments(["start", "--port", "6767.0"])).toThrow("--port");
  expect(() => parseArguments(["update", "--check", "--apply"])).toThrow("Choose one");
  expect(parseArguments(["status", "--json"]).values.has("--json")).toBe(true);
});

it("reports corrupt preferences through doctor without modifying them", async () => {
  const file = path.join(paths.runtime, "lifecycle.json");
  await writeFile(file, "{invalid");
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await doctorCommand();
    const diagnostic = JSON.parse(output.mock.calls[0][0]);
    expect(diagnostic.issues.preferences).toEqual(expect.any(String));
    expect(diagnostic.installedVersion).toBe("1.1.0");
  } finally { output.mockRestore(); }
});

it("does not restart a newly updated runtime after a newer stop request", async () => {
  const { requestRuntimeStop } = await import("../../../packages/cli/src/preferences");
  mocks.install.mockImplementationOnce(async () => {
    await writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version: "1.2.0", previousVersion: "1.1.0" });
    await requestRuntimeStop(paths);
    return true;
  });
  await expect(startRuntime(paths, { version: "1.2.0" })).rejects.toThrow("Start cancelled");
  expect(mocks.start).not.toHaveBeenCalled();
});
