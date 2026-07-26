import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("local CLI production capability paths", () => {
  it("uses the default worker, writing SSE route, and resume parser with real repositories", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "switchy-cli-production-home-"));
    temporaryHomes.push(home);
    const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
    const serverOnlyRegister = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "ai",
      "register-server-only.mjs"
    );
    const nodeOptions = [
      existingNodeOptions,
      "--conditions=react-server",
      `--import=${serverOnlyRegister}`,
    ]
      .filter(Boolean)
      .join(" ");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      NODE_ENV: "test",
      NODE_OPTIONS: nodeOptions,
    };
    delete environment.SWITCHY_HOME;
    const output = execFileSync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["tests/fixtures/ai/local-cli-production-flow.mts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        timeout: 60_000,
      }
    );
    const resultLine = output.split("\n").find((line) =>
      line.startsWith("SWITCHY_E2E_RESULT=")
    );
    expect(resultLine).toBeDefined();
    expect(JSON.parse(resultLine!.slice("SWITCHY_E2E_RESULT=".length))).toMatchObject({
      matchResults: 1,
      writingVariants: 1,
      cancelledWritingRuns: 1,
    });
  }, 70_000);
});
