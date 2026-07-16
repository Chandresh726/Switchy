import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stateCliArguments } from "@/lib/state/cli-arguments";

describe("local state command contracts", () => {
  it("accepts pnpm's documented argument separator", () => {
    expect(stateCliArguments(["--", "--environment", "production"])).toEqual([
      "--environment",
      "production",
    ]);
    expect(stateCliArguments(["--from", "/snapshot"])).toEqual([
      "--from",
      "/snapshot",
    ]);
  });

  it("exposes the documented backup, verification, and restore scripts", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["state:backup"]).toBe("tsx scripts/state-backup.ts");
    expect(packageJson.scripts["state:backup:verify"]).toBe(
      "tsx scripts/state-backup-verify.ts"
    );
    expect(packageJson.scripts["state:restore"]).toBe("tsx scripts/state-restore.ts");
  });
});
