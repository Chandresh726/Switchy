import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  scripts: Record<string, string>;
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8")
  ) as PackageManifest;
}

describe("package scripts", () => {
  it("uses one database preparation entrypoint", () => {
    const packageJson = readPackageManifest();

    expect(packageJson.scripts["db:migrate"]).toBe("tsx scripts/migrate-database.ts");
    expect(packageJson.scripts["db:cleanup-job-duplicates"]).toBeUndefined();
  });

  it("only references script files that exist", () => {
    const packageJson = readPackageManifest();
    const referencedFiles = Object.values(packageJson.scripts).flatMap((command) =>
      Array.from(
        command.matchAll(/\b(?:[\w.-]+\/)*scripts\/[\w./-]+/g),
        ([file]) => file
      )
    );

    expect(referencedFiles.length).toBeGreaterThan(0);
    for (const file of referencedFiles) {
      expect(existsSync(join(process.cwd(), file)), `${file} should exist`).toBe(true);
    }
  });
});
