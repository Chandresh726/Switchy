import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { optimizeRuntime } from "../../../scripts/optimize-runtime.mjs";

const targets = ["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"];
it.each(targets)("prunes SQLite for %s and preserves module paths through a tar round trip", async (target) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "switchy-runtime-optimization-"));
  try {
    const runtime = path.join(root, "runtime");
    const sqlite = path.join(runtime, "node_modules/better-sqlite3");
    const alias = path.join(runtime, ".next/node_modules/better-sqlite3-hash");
    for (const pkg of [sqlite, alias]) {
      await mkdir(path.join(pkg, "prebuilds"), { recursive: true });
      await mkdir(path.join(pkg, "deps"));
      await writeFile(path.join(pkg, "deps/sqlite.c"), "build source");
      await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "better-sqlite3" }));
      await writeFile(path.join(pkg, "LICENSE"), "license");
      for (const platform of [...targets, "linuxmusl-x64", "darwin-x64"]) await writeFile(path.join(pkg, `prebuilds/${platform}.node`), `binding for ${platform}`);
    }
    await mkdir(path.join(runtime, ".next/static"));
    await writeFile(path.join(runtime, ".next/static/license.txt"), "license");
    const optimized = await optimizeRuntime(runtime, target);
    expect(optimized.linkedFiles).toBeGreaterThan(0);
    expect(await readdir(path.join(sqlite, "prebuilds"))).toEqual([`${target}.node`]);
    expect(await stat(path.join(sqlite, "deps")).catch(() => null)).toBeNull();
    if (process.platform !== "win32") {
      expect((await stat(path.join(sqlite, "LICENSE"))).ino).toBe((await stat(path.join(alias, "LICENSE"))).ino);
      expect((await stat(path.join(sqlite, "LICENSE"))).ino).not.toBe((await stat(path.join(runtime, ".next/static/license.txt"))).ino);
    }
    const archive = path.join(root, "runtime.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", runtime, "."]);
    const restored = path.join(root, "restored");
    await mkdir(restored);
    execFileSync("tar", ["-xzf", archive, "-C", restored]);
    for (const pkg of ["node_modules/better-sqlite3", ".next/node_modules/better-sqlite3-hash"]) {
      expect(await readFile(path.join(restored, pkg, `prebuilds/${target}.node`), "utf8")).toBe(`binding for ${target}`);
      expect(await readFile(path.join(restored, pkg, "LICENSE"), "utf8")).toBe("license");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
