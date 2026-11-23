import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyNpmInstallation } from "../../../scripts/verify-npm-installation.mjs";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.sleep }));

const name = "@chandresh726/switchy";
const version = "1.2.3";
const success = { status: 0, stdout: `${version}\n`, stderr: "" };
const missingVersion = {
  status: 1,
  stdout: "",
  stderr: `ERR_PNPM_NO_MATCHING_VERSION\nNo matching version found for ${name}@${version} while fetching it from https://registry.npmjs.org/`,
};

beforeEach(() => {
  mocks.spawnSync.mockReset().mockReturnValue(success);
  mocks.sleep.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("published npm installation verification", () => {
  it("installs the exact version and returns without waiting when available", async () => {
    vi.stubEnv("RUNNER_TEMP", "/temporary-release-verification");

    await verifyNpmInstallation(name, version);

    expect(mocks.spawnSync).toHaveBeenCalledExactlyOnceWith("pnpm", [
      "--config.verify-deps-before-run=false", "--reporter=silent",
      "dlx", `${name}@${version}`, "version",
    ], {
      cwd: "/temporary-release-verification", encoding: "utf8", timeout: 120_000,
    });
    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it.each(["stderr", "stdout"] as const)("retries propagation errors reported on %s", async (stream) => {
    mocks.spawnSync.mockReturnValueOnce({ ...missingVersion, stderr: "", [stream]: missingVersion.stderr });

    await verifyNpmInstallation(name, version);

    expect(mocks.spawnSync).toHaveBeenCalledTimes(2);
    expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(15_000);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`${name}@${version}`));
  });

  it("fails after six unresolved attempts instead of waiting indefinitely", async () => {
    mocks.spawnSync.mockReturnValue(missingVersion);

    await expect(verifyNpmInstallation(name, version)).rejects.toThrow("after 6 attempt(s)");

    expect(mocks.spawnSync).toHaveBeenCalledTimes(6);
    expect(mocks.sleep).toHaveBeenCalledTimes(5);
  });

  it.each([
    "ERR_PNPM_FETCH_403 Forbidden",
    "ERR_PNPM_TARBALL_INTEGRITY Integrity check failed",
    "ERR_PNPM_NO_MATCHING_VERSION\nNo matching version found for tar@999.0.0",
    `ERR_PNPM_NO_MATCHING_VERSION\nNo matching version found for ${name}@${version}0`,
    "Switchy requires Node.js 24",
  ])("fails immediately for non-propagation errors: %s", async (stderr) => {
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr });

    await expect(verifyNpmInstallation(name, version)).rejects.toThrow(stderr);

    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it("does not hide an incorrect installed version", async () => {
    mocks.spawnSync.mockReturnValue({ ...success, stdout: "0.0.1\n" });

    await expect(verifyNpmInstallation(name, version)).rejects.toThrow("Installed CLI reports the wrong version");

    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it("does not retry a process error or timeout", async () => {
    const error = new Error("spawnSync pnpm ETIMEDOUT");
    mocks.spawnSync.mockReturnValue({ error });

    await expect(verifyNpmInstallation(name, version)).rejects.toBe(error);

    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it("limits subsequent process timeouts to the remaining three-minute budget", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.spawnSync.mockImplementationOnce(() => {
      now += 100_000;
      return missingVersion;
    });
    mocks.sleep.mockImplementation(async () => { now += 15_000; });

    await verifyNpmInstallation(name, version);

    expect(mocks.spawnSync.mock.calls[1][2].timeout).toBe(65_000);
  });

  it("stops when the time budget cannot accommodate another retry", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.spawnSync.mockImplementation(() => {
      now = 170_000;
      return missingVersion;
    });

    await expect(verifyNpmInstallation(name, version)).rejects.toThrow("after 1 attempt(s)");

    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
    expect(mocks.sleep).not.toHaveBeenCalled();
  });
});
