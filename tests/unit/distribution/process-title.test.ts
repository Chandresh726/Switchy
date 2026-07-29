import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const preloadPath = path.join(
  process.cwd(),
  "scripts",
  "switchy-process-title.cjs"
);
const nextEntrypoint = path.join(
  os.tmpdir(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);
const titleProbe = [
  'process.title = "next-server (v16.2.12)";',
  "setTimeout(() => process.stdout.write(process.title), 75);",
].join("\n");

function probeTitle(
  requestedTitle: string,
  args: string[],
  environment: Record<string, string | undefined> = {}
): string {
  return execFileSync(process.execPath, ["-e", titleProbe, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      NODE_OPTIONS: `--require=${preloadPath}`,
      SWITCHY_PROCESS_TITLE: requestedTitle,
    },
  });
}

describe("Next.js process branding", () => {
  it("restores the Switchy title after next start overwrites it", () => {
    expect(probeTitle("Switchy", [nextEntrypoint, "start"])).toBe("Switchy");
  });

  it("restores the Switchy Dev title in the forked dev server", () => {
    expect(probeTitle("Switchy Dev", [], {
      NEXT_PRIVATE_WORKER: "1",
      __NEXT_DEV_SERVER: "1",
    })).toBe("Switchy Dev");
  });
});
