import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import * as atomicFile from "@/lib/runtime/atomic-file";
import { writeJsonFileAtomic } from "@/lib/runtime/atomic-file";
import { verifyLaunchRecord } from "@/lib/runtime/launch-record";

let root: string;
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); });

it("admits only the process whose launch identity was published", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-launch-record-"));
  vi.stubEnv("SWITCHY_HOME", root);
  vi.stubEnv("SWITCHY_INSTANCE_ID", "candidate");
  await mkdir(path.join(root, "runtime"));
  const file = path.join(root, "runtime/process.json");
  await writeJsonFileAtomic(file, { pid: process.pid, instanceId: "candidate" });
  await expect(verifyLaunchRecord()).resolves.toBeUndefined();
  await writeJsonFileAtomic(file, { pid: process.pid, instanceId: "another-instance" });
  const read = vi.spyOn(atomicFile, "readJsonFile").mockResolvedValue({ pid: process.pid, instanceId: "another-instance" });
  vi.useFakeTimers();
  try {
    const rejected = expect(verifyLaunchRecord()).rejects.toThrow("launcher did not publish");
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
  } finally { read.mockRestore(); }
});
