import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { migrateLocalDatabase } from "@/lib/db/migrations";
import * as schema from "@/lib/db/schema";
import { settings } from "@/lib/db/schema";
import { writeJsonFileAtomic } from "../../../packages/cli/src/files";
import { ensureSwitchyDirectories, getSwitchyPaths } from "../../../packages/cli/src/paths";
import { installUpdate } from "../../../packages/cli/src/updater";

vi.mock("../../../packages/cli/src/process-manager", () => ({
  getRunningProcess: async () => null, stopSwitchy: vi.fn(), startSwitchyProcess: vi.fn(), fetchLiveness: vi.fn(),
}));
vi.mock("../../../packages/cli/src/release", async (original) => ({
  ...await original<typeof import("../../../packages/cli/src/release")>(),
  installRuntime: async (_version: string, paths: ReturnType<typeof getSwitchyPaths>) => path.join(paths.versions, "1.1.0"),
}));
vi.mock("../../../packages/cli/src/runtime", async (original) => ({
  ...await original<typeof import("../../../packages/cli/src/runtime")>(), ensurePlaywrightBrowser: vi.fn(), runDatabaseMigration: vi.fn(),
}));
let root: string;
let paths: ReturnType<typeof getSwitchyPaths>;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "switchy-sqlite-update-"));
  paths = getSwitchyPaths(root);
  await ensureSwitchyDirectories(paths);
  await mkdir(paths.productionData);
  await mkdir(path.join(paths.versions, "1.1.0/bin"), { recursive: true });
  await writeFile(path.join(paths.versions, "1.1.0/bin/lifecycle.cjs"), "");
  await writeJsonFileAtomic(path.join(paths.versions, "1.1.0/switchy-runtime.json"), { lifecycleProtocol: 2 });
  await writeJsonFileAtomic(paths.currentVersion, { schemaVersion: 1, version: "1.0.0" });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("restores a real SQLite database, uploads and the encryption secret after a failed migration", async () => {
  const databasePath = path.join(paths.productionData, "switchy.db");
  const seed = new Database(databasePath);
  try {
    const database = drizzle(seed, { schema });
    migrateLocalDatabase(database, path.join(process.cwd(), "drizzle"));
    database.insert(settings).values({ key: "update-regression", value: "original" }).run();
  } finally { seed.close(); }
  await writeFile(path.join(paths.productionData, "encryption.secret"), "preserved-secret");
  await mkdir(path.join(paths.productionData, "uploads"));
  await writeFile(path.join(paths.productionData, "uploads/resume.pdf"), "preserved-upload");
  const { runDatabaseMigration } = await import("../../../packages/cli/src/runtime");
  vi.mocked(runDatabaseMigration).mockImplementationOnce(async () => {
    const candidate = new Database(databasePath);
    try { drizzle(candidate).update(settings).set({ value: "candidate-write" }).run(); } finally { candidate.close(); }
    await writeFile(path.join(paths.productionData, "encryption.secret"), "candidate-secret");
    throw new Error("migration interrupted");
  });
  await expect(installUpdate(paths, "1.1.0", true)).rejects.toThrow("migration interrupted");
  const restored = new Database(databasePath);
  try {
    expect(drizzle(restored).select().from(settings).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "update-regression", value: "original" }),
    ]));
  } finally { restored.close(); }
  expect(await readFile(path.join(paths.productionData, "encryption.secret"), "utf8")).toBe("preserved-secret");
  expect(await readFile(path.join(paths.productionData, "uploads/resume.pdf"), "utf8")).toBe("preserved-upload");
});
