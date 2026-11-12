import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { materializeTracedPackages } from "../../../scripts/runtime-traced-packages.mjs";

describe("standalone traced packages", () => {
  it("replaces a broken copied alias using its original package source", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "switchy-traced-packages-"));
    try {
      const source = path.join(directory, "standalone", ".next");
      const destination = path.join(directory, "runtime", ".next");
      const packageSource = path.join(directory, "package-source");
      await mkdir(packageSource, { recursive: true });
      await writeFile(path.join(packageSource, "package.json"), JSON.stringify({ name: "native-module", version: "1.0.0" }));
      await mkdir(path.join(source, "node_modules"), { recursive: true });
      await mkdir(path.join(destination, "node_modules"), { recursive: true });
      const alias = "native-module-hash";
      await symlink(packageSource, path.join(source, "node_modules", alias), "junction");
      await symlink(path.join(directory, "missing-package"), path.join(destination, "node_modules", alias), "junction");
      const materialize = vi.fn(async (from: string, to: string) => {
        await rm(to, { force: true, recursive: true });
        await cp(from, to, { recursive: true, dereference: true });
      });
      await materializeTracedPackages(source, destination, materialize);
      expect(materialize).toHaveBeenCalledWith(path.join(source, "node_modules", alias), path.join(destination, "node_modules", alias));
      expect(JSON.parse(await readFile(path.join(destination, "node_modules", alias, "package.json"), "utf8"))).toMatchObject({ name: "native-module" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("supports standalone builds without Turbopack aliases", async () => {
    const materialize = vi.fn();
    await materializeTracedPackages(path.join(os.tmpdir(), "switchy-nonexistent-traced-directory"), "unused", materialize);
    expect(materialize).not.toHaveBeenCalled();
  });
});
