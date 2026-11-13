import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Switchy distribution metadata", () => {
  it("uses the publishable CLI package as the release version source", () => {
    const application = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as {
      version?: string;
      private: boolean;
      license: string;
      scripts: Record<string, string>;
    };
    const cli = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "packages", "cli", "package.json"),
        "utf8"
      )
    ) as {
      name: string;
      version: string;
      license: string;
      private?: boolean;
      bin: Record<string, string>;
      publishConfig: { access: string };
    };

    expect(application).toMatchObject({
      private: true,
      license: "MIT",
    });
    expect(application.version).toBeUndefined();
    expect(application.scripts["release:version"]).toBe(
      "pnpm --filter @chandresh726/switchy version --no-git-checks --no-git-tag-version"
    );
    for (const script of [application.scripts.dev, application.scripts.start]) {
      expect(script).toContain("--hostname 127.0.0.1");
    }
    expect(cli).toMatchObject({
      name: "@chandresh726/switchy",
      license: application.license,
      bin: { switchy: "dist/cli.js" },
      publishConfig: { access: "public" },
    });
    expect(cli.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(cli.private).not.toBe(true);
  });
});
