import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

// Read production through SQLite's backup API. All application initialization
// and migrations run against the disposable snapshot, never the source.
const root = await mkdtemp(path.join(os.tmpdir(), "switchy-api-benchmark-"));
try {
  const target = path.join(root, "data", "production");
  await mkdir(target, { recursive: true });
  const source = new Database(process.argv[2] ?? path.join(os.homedir(), ".switchy/data/production/switchy.db"), {
    readonly: true, fileMustExist: true,
  });
  try { await source.backup(path.join(target, "switchy.db")); } finally { source.close(); }
  process.env.SWITCHY_HOME = root;
  Object.assign(process.env, { NODE_ENV: "production" });
  const { db } = await import("../lib/db/index");
  try {
    const { migrateLocalDatabase } = await import("../lib/db/migrations");
    migrateLocalDatabase(db, path.join(process.cwd(), "drizzle"));
    const { listJobs, getJobStatusCounts } = await import("../lib/application/jobs-service");
    const { getDashboardStats } = await import("../lib/application/stats-service");
    const { jobsQuerySchema } = await import("../lib/api/contracts/jobs");
    const { withApiTiming } = await import("../lib/api/timing");
    const results = [];
    for (const [name, operation] of [
      ["jobs_date", () => listJobs(jobsQuerySchema.parse({ sortBy: "discoveredAt" }))],
      ["jobs_score", () => listJobs(jobsQuerySchema.parse({ sortBy: "matchScore" }))],
      ["job_counts", () => getJobStatusCounts()],
      ["dashboard_stats", () => getDashboardStats()],
    ] as const) {
      const times: number[] = [];
      let bytes = 0;
      let queries = 0;
      for (let i = 0; i < 9; i += 1) {
        const started = performance.now();
        const response = await withApiTiming(async () => Response.json(await operation()));
        if (i > 0) times.push(performance.now() - started);
        bytes = (await response.arrayBuffer()).byteLength;
        queries = Number(response.headers.get("X-DB-Query-Count"));
      }
      times.sort((a, b) => a - b);
      results.push({ name, medianMs: Number(((times[3] + times[4]) / 2).toFixed(2)), bytes, queries });
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { db.$client.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
