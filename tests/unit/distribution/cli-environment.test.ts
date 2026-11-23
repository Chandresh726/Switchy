import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { getSwitchyPaths } from "../../../packages/cli/src/paths";
import { lifecycleFiles } from "../../../packages/cli/src/lifecycle-state";
import { readJsonFile } from "../../../packages/cli/src/files";
import { runtimeEnvironment, saveStartupEnvironment } from "../../../packages/cli/src/startup-environment";

let root: string;
afterEach(async () => { vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); });

it("retains tool discovery under a minimal startup environment without saving shell credentials", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-environment-"));
  const paths = getSwitchyPaths(root);
  await mkdir(lifecycleFiles(paths).host, { recursive: true });
  const tools = path.join(root, "my-tools");
  vi.stubEnv("PATH", tools);
  vi.stubEnv("SWITCHY_CODEX_CLI_PATH", path.join(tools, "codex"));
  vi.stubEnv("SWITCHY_AUDIT_SECRET", "must-not-be-saved");
  await saveStartupEnvironment(paths);
  vi.stubEnv("PATH", "/usr/bin:/bin");
  delete process.env.SWITCHY_CODEX_CLI_PATH;
  const environment = await runtimeEnvironment(paths);
  expect(environment.PATH?.split(path.delimiter)).toContain(tools);
  expect(environment.SWITCHY_CODEX_CLI_PATH).toBe(path.join(tools, "codex"));
  expect(environment.PATH?.split(path.delimiter)).toContain(lifecycleFiles(paths).host);
  expect(JSON.stringify(await readJsonFile(path.join(lifecycleFiles(paths).host, "environment.json")))).not.toContain("must-not-be-saved");
});
