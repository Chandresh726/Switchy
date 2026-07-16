import { chmod } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settingValue: undefined as string | undefined }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.settingValue === undefined
            ? []
            : [{ value: mocks.settingValue }],
        }),
      }),
    }),
  },
}));

import { resolveCLIExecutable } from "@/lib/ai/local-cli/executable";

const executable = path.join(process.cwd(), "tests", "fixtures", "ai", "fake-codex-cli.mjs");
const originalPath = process.env.PATH;
const originalCodexPath = process.env.SWITCHY_CODEX_CLI_PATH;

beforeAll(async () => {
  await chmod(executable, 0o755);
});

afterEach(() => {
  mocks.settingValue = undefined;
  process.env.PATH = originalPath;
  if (originalCodexPath === undefined) delete process.env.SWITCHY_CODEX_CLI_PATH;
  else process.env.SWITCHY_CODEX_CLI_PATH = originalCodexPath;
});

describe("local CLI executable resolution", () => {
  it("prefers the Advanced setting over the environment and PATH", async () => {
    mocks.settingValue = executable;
    process.env.SWITCHY_CODEX_CLI_PATH = "/missing/environment/codex";
    process.env.PATH = "/missing/path";
    await expect(resolveCLIExecutable("codex_cli")).resolves.toBe(executable);
  });

  it("uses the environment override when no setting is present", async () => {
    process.env.SWITCHY_CODEX_CLI_PATH = executable;
    process.env.PATH = "/missing/path";
    await expect(resolveCLIExecutable("codex_cli")).resolves.toBe(executable);
  });

  it("does not silently fall back when an explicit override is invalid", async () => {
    mocks.settingValue = "/missing/advanced/codex";
    process.env.SWITCHY_CODEX_CLI_PATH = executable;
    await expect(resolveCLIExecutable("codex_cli")).resolves.toBeNull();
  });
});
