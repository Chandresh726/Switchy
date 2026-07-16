import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("local-only application boundary", () => {
  it("binds development and production servers to loopback", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.dev).toContain("--hostname 127.0.0.1");
    expect(packageJson.scripts.start).toContain("--hostname 127.0.0.1");
  });

  it("does not expose the retired generic upload route", () => {
    expect(existsSync(join(process.cwd(), "app/api/upload/route.ts"))).toBe(false);
  });
});
