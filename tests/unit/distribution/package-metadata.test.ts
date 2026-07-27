import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Switchy distribution metadata", () => {
  it("keeps application and CLI versions aligned", () => {
    const application = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as {
      version: string;
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
      version: "1.0.9",
      private: true,
      license: "MIT",
    });
    expect(application.scripts.start).toBe(
      "NODE_ENV=production next start --hostname 127.0.0.1 --port 6767"
    );
    expect(cli).toMatchObject({
      name: "@chandresh726/switchy",
      version: application.version,
      license: application.license,
      bin: { switchy: "dist/cli.js" },
      publishConfig: { access: "public" },
    });
    expect(cli.private).not.toBe(true);
  });
});
