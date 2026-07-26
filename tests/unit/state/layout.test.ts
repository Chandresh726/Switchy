import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureSwitchyLayoutSync,
  getEnvironmentDataDirectory,
  getSwitchyRootDirectory,
} from "@/lib/state/layout";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = path.join(
    os.tmpdir(),
    `switchy-layout-${crypto.randomUUID()}`
  );
  mkdirSync(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Switchy local layout", () => {
  it("uses a configured root and creates operational subdirectories", () => {
    const root = path.join(temporaryDirectory(), "custom-switchy");

    expect(getSwitchyRootDirectory("/ignored", root)).toBe(root);
    ensureSwitchyLayoutSync(root);

    for (const relativePath of [
      "data",
      "app/versions",
      "runtime",
      "logs",
      "cache/downloads",
      "cache/playwright",
      "update-snapshots",
    ]) {
      expect(existsSync(path.join(root, relativePath))).toBe(true);
    }
    expect(JSON.parse(readFileSync(path.join(root, "layout.json"), "utf8")))
      .toEqual({ version: 1 });
  });

  it("moves legacy production and development data under data directories", () => {
    const root = path.join(temporaryDirectory(), ".switchy");
    mkdirSync(path.join(root, "uploads"), { recursive: true });
    mkdirSync(path.join(root, "dev", "uploads"), { recursive: true });
    writeFileSync(path.join(root, "switchy.db"), "production");
    writeFileSync(path.join(root, "encryption.secret"), "production-secret");
    writeFileSync(path.join(root, "uploads", "resume.pdf"), "resume");
    writeFileSync(path.join(root, "dev", "switchy.db"), "development");

    ensureSwitchyLayoutSync(root);

    expect(readFileSync(
      path.join(getEnvironmentDataDirectory("production", root), "switchy.db"),
      "utf8"
    )).toBe("production");
    expect(readFileSync(
      path.join(getEnvironmentDataDirectory("development", root), "switchy.db"),
      "utf8"
    )).toBe("development");
    expect(existsSync(path.join(root, "switchy.db"))).toBe(false);
    expect(existsSync(path.join(root, "dev"))).toBe(false);
    const migration = JSON.parse(
      readFileSync(path.join(root, "runtime", "layout-migration.json"), "utf8")
    ) as { snapshotDirectory: string };
    expect(readFileSync(
      path.join(migration.snapshotDirectory, "production", "switchy.db"),
      "utf8"
    )).toBe("production");
  });

  it("refuses to merge legacy data with an existing current database", () => {
    const root = path.join(temporaryDirectory(), ".switchy");
    mkdirSync(
      getEnvironmentDataDirectory("production", root),
      { recursive: true }
    );
    writeFileSync(path.join(root, "switchy.db"), "legacy");
    writeFileSync(
      path.join(getEnvironmentDataDirectory("production", root), "switchy.db"),
      "current"
    );

    expect(() => ensureSwitchyLayoutSync(root)).toThrow(
      "Cannot merge legacy and current Switchy data"
    );
  });

  it("refuses to migrate while a legacy runtime lock is alive", () => {
    const root = path.join(temporaryDirectory(), ".switchy");
    mkdirSync(root, { recursive: true });
    mkdirSync(`${root}.coordination`, { recursive: true });
    writeFileSync(path.join(root, "switchy.db"), "legacy");
    writeFileSync(
      path.join(
        `${root}.coordination`,
        `.switchy-runtime-${process.pid}.json`
      ),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
    );

    expect(() => ensureSwitchyLayoutSync(root)).toThrow(
      "Switchy is still running from the legacy data layout"
    );
  });

  it("refuses migration when a legacy runtime lock cannot be verified", () => {
    const root = path.join(temporaryDirectory(), ".switchy");
    mkdirSync(root, { recursive: true });
    mkdirSync(`${root}.coordination`, { recursive: true });
    writeFileSync(path.join(root, "switchy.db"), "legacy");
    writeFileSync(
      path.join(`${root}.coordination`, ".switchy-runtime-invalid.json"),
      "{invalid"
    );

    expect(() => ensureSwitchyLayoutSync(root)).toThrow(
      "Cannot verify legacy runtime lock"
    );
  });

  it("refuses to move malformed legacy data artifacts", () => {
    const root = path.join(temporaryDirectory(), ".switchy");
    mkdirSync(path.join(root, "switchy.db"), { recursive: true });

    expect(() => ensureSwitchyLayoutSync(root)).toThrow(
      "Legacy Switchy data must use regular files and directories"
    );
  });

  it("times out rather than replacing a live layout migration lock", () => {
    const root = path.join(temporaryDirectory(), ".switchy");
    const lockDirectory = path.join(root, "runtime", "layout.lock");
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(
      path.join(lockDirectory, "owner.json"),
      JSON.stringify({ pid: process.pid, token: crypto.randomUUID() })
    );

    const startedAt = Date.now();
    expect(() => ensureSwitchyLayoutSync(root, 100)).toThrow(
      "Timed out waiting for Switchy layout initialization"
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
  });
});
