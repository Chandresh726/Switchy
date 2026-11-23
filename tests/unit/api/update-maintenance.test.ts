import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { assertAppRequest } from "@/lib/api/request-guard";
import { isUpdateMaintenance } from "@/lib/runtime/update-maintenance";
import { proxy } from "@/proxy";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-maintenance-"));
  vi.stubEnv("SWITCHY_HOME", root);
  vi.stubEnv("NODE_ENV", "production");
  await mkdir(path.join(root, "runtime"), { recursive: true });
  await writeFile(path.join(root, "runtime/update-maintenance.json"), "{}");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("blocks user API requests while a candidate is being checked but keeps health and recovery reachable", () => {
  expect(isUpdateMaintenance()).toBe(true);
  expect(proxy(new NextRequest("http://localhost/api/jobs"))).toHaveProperty("status", 503);
  expect(proxy(new NextRequest("http://localhost/api/health/ready"))).toHaveProperty("status", 200);
  expect(proxy(new NextRequest("http://localhost/api/lifecycle/activity"))).toHaveProperty("status", 200);
  expect(() => assertAppRequest(new Request("http://localhost/api/jobs/1", {
    method: "PATCH", headers: { "X-Switchy-Request": "true" },
  }))).toThrow("Switchy is updating");
});

it("does not block the development app when production is updating", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(isUpdateMaintenance()).toBe(false);
  expect(proxy(new NextRequest("http://localhost/api/jobs"))).toHaveProperty("status", 200);
});
