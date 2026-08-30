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
      version: "1.0.18",
      private: true,
      license: "MIT",
    });
    expect(application.scripts.dev).toBe(
      "NODE_ENV=development "
      + "SWITCHY_MACOS_NOTIFICATION_HELPER='./.switchy-build/native/macos/"
      + "Switchy Notifications.app/Contents/MacOS/SwitchyNotifier' "
      + "SWITCHY_PROCESS_TITLE='Switchy Dev' "
      + "NODE_OPTIONS=\"$NODE_OPTIONS "
      + "--require=./scripts/switchy-process-title.cjs\" "
      + "next dev --hostname 127.0.0.1"
    );
    expect(application.scripts.start).toBe(
      "NODE_ENV=production "
      + "SWITCHY_MACOS_NOTIFICATION_HELPER='./.switchy-build/native/macos/"
      + "Switchy Notifications.app/Contents/MacOS/SwitchyNotifier' "
      + "SWITCHY_PROCESS_TITLE=Switchy "
      + "NODE_OPTIONS=\"$NODE_OPTIONS "
      + "--require=./scripts/switchy-process-title.cjs\" "
      + "next start --hostname 127.0.0.1 --port 6767"
    );
    expect(application.scripts.predev).toContain("pnpm native:prepare");
    expect(application.scripts.prestart).toContain("pnpm native:prepare");
    expect(application.scripts["native:prepare"]).toBe(
      "node scripts/build-macos-notifier.mjs"
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

  it("keeps macOS runtime packaging independent of Apple credentials", () => {
    const workflow = readFileSync(
      path.join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8"
    );
    const builder = readFileSync(
      path.join(process.cwd(), "scripts", "build-macos-notifier.mjs"),
      "utf8"
    );

    expect(workflow).not.toContain("scripts/configure-macos-release-");
    expect(builder).not.toContain("notarytool");
    expect(builder).toContain('["--force", "--deep", "--sign", "-", bundle]');
  });
});
