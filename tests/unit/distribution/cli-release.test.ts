import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getSwitchyPaths } from "../../../packages/cli/src/paths";
import { currentTarget } from "../../../packages/cli/src/platform";
import {
  DEFAULT_PORT,
  assertSupportedNodeVersion,
  resolveApplicationVersion,
} from "../../../packages/cli/src/config";
import {
  assertStableVersion,
  installRuntime,
  notificationRuntimeFiles,
  parseReleaseManifest,
  setCurrentVersion,
} from "../../../packages/cli/src/release";
import { readJsonFile } from "../../../packages/cli/src/files";
import type { CurrentVersionRecord } from "../../../packages/cli/src/types";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = path.join(
    os.tmpdir(),
    `switchy-cli-${crypto.randomUUID()}`
  );
  await mkdir(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

async function writeRuntimeFiles(source: string): Promise<void> {
  const files = [
    "server.js",
    "bin/migrate.cjs",
    "drizzle/meta/_journal.json",
    ...notificationRuntimeFiles(currentTarget()),
  ];
  for (const file of files) {
    const destination = path.join(source, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, "{}", {
      mode: file.endsWith("/SwitchyNotifier") ? 0o700 : 0o600,
    });
  }
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Switchy CLI release handling", () => {
  it("maps supported native targets and rejects unsupported ones", () => {
    expect(currentTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentTarget("linux", "x64")).toBe("linux-x64");
    expect(() => currentTarget("aix", "ppc64")).toThrow(
      "does not provide a runtime"
    );
  });

  it("requires the notification helper on macOS and nothing elsewhere", () => {
    expect(notificationRuntimeFiles("darwin-arm64")).toContain(
      "bin/Switchy Notifications.app/Contents/MacOS/SwitchyNotifier"
    );
    expect(notificationRuntimeFiles("linux-x64")).toEqual([]);
    expect(notificationRuntimeFiles("win32-x64")).toEqual([]);
  });

  it("requires an absolute Switchy home override", () => {
    expect(() => getSwitchyPaths("relative-switchy-home")).toThrow(
      "SWITCHY_HOME must be an absolute path"
    );
  });

  it("validates release manifests", () => {
    const manifest = parseReleaseManifest({
      schemaVersion: 1,
      version: "1.0.2",
      publishedAt: new Date().toISOString(),
      nodeVersion: "24.12.0",
      artifacts: {
        "darwin-arm64": {
          file: "switchy-1.0.2-darwin-arm64.tar.gz",
          sha256: "a".repeat(64),
          size: 100,
        },
      },
    });

    expect(manifest.version).toBe("1.0.2");
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: {
        "darwin-arm64": {
          ...manifest.artifacts["darwin-arm64"],
          sha256: "../invalid",
        },
      },
    })).toThrow("invalid artifact");
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: {
        "darwin-arm64": {
          ...manifest.artifacts["darwin-arm64"],
          file: "../switchy-1.0.2-darwin-arm64.tar.gz",
        },
      },
    })).toThrow("invalid artifact");
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: {
        "darwin-arm64": {
          ...manifest.artifacts["darwin-arm64"],
          file: "switchy-1.0.1-darwin-arm64.tar.gz",
        },
      },
    })).toThrow("inconsistent artifact metadata");
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: {
        "freebsd-x64": manifest.artifacts["darwin-arm64"],
      },
    })).toThrow("unsupported target");
  });

  it("accepts only stable application versions", () => {
    expect(assertStableVersion("1.0.2")).toBe("1.0.2");
    expect(() => assertStableVersion("../1.0.2")).toThrow("Invalid stable");
    expect(() => assertStableVersion("1.0.3-beta.1")).toThrow("Invalid stable");
  });

  it("uses the executing CLI version unless an app version is requested", () => {
    expect(resolveApplicationVersion()).toBe("1.0.17");
    expect(resolveApplicationVersion("1.0.1")).toBe("1.0.1");
  });

  it("uses the dedicated production port by default", () => {
    expect(DEFAULT_PORT).toBe(6767);
  });

  it("rejects Node.js versions that cannot run the packaged runtime", () => {
    expect(() => assertSupportedNodeVersion("24.12.0")).not.toThrow();
    expect(() => assertSupportedNodeVersion("22.20.0")).toThrow(
      "requires Node.js 24"
    );
    expect(() => assertSupportedNodeVersion("25.1.0")).toThrow(
      "requires Node.js 24"
    );
  });

  it("installs a validated local runtime and records it as current", async () => {
    const root = await temporaryDirectory();
    const source = await temporaryDirectory();
    await writeRuntimeFiles(source);
    await writeFile(
      path.join(source, "switchy-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "1.0.2",
        target: currentTarget(),
        nodeVersion: process.versions.node,
        builtAt: new Date().toISOString(),
      })
    );
    vi.stubEnv("SWITCHY_RUNTIME_SOURCE", source);
    const paths = getSwitchyPaths(root);
    await mkdir(paths.versions, { recursive: true });

    const installed = await installRuntime("1.0.2", paths);
    await setCurrentVersion(paths, "1.0.2");

    expect(installed).toBe(path.join(paths.versions, "1.0.2"));
    expect(await readJsonFile<CurrentVersionRecord>(paths.currentVersion))
      .toMatchObject({ schemaVersion: 1, version: "1.0.2" });
  });

  it("rejects runtime metadata for another version or platform", async () => {
    const root = await temporaryDirectory();
    const source = await temporaryDirectory();
    await writeRuntimeFiles(source);
    await writeFile(
      path.join(source, "switchy-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "1.0.1",
        target: currentTarget(),
        nodeVersion: process.versions.node,
        builtAt: new Date().toISOString(),
      })
    );
    vi.stubEnv("SWITCHY_RUNTIME_SOURCE", source);
    const paths = getSwitchyPaths(root);
    await mkdir(paths.versions, { recursive: true });

    await expect(installRuntime("1.0.2", paths)).rejects.toThrow(
      "Runtime metadata does not match"
    );
  });
});
