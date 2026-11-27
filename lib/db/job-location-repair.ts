import { eq, isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";

import { formatJobLocation, isLocationCountLabel } from "@/lib/jobs/locations";
import { buildJobFingerprintFromRecord } from "@/lib/ai/artifacts/fingerprints";

import type * as schema from "./schema";
import { jobs } from "./schema";

/** Repair display metadata without changing user state or freshness timestamps. */
export function repairPlaceholderJobLocations(database: BetterSQLite3Database<typeof schema>): number {
  // Restore tooling and upgrade tests can deliberately apply an older prefix.
  const client = (database as unknown as { $client: Database.Database }).$client;
  const columns = client.pragma("table_info(jobs)") as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "source_locations")) return 0;
  return database.transaction((tx) => {
    const candidates = tx.select({ id: jobs.id, location: jobs.location, locations: jobs.sourceLocations })
      .from(jobs).where(isNotNull(jobs.sourceLocations)).all();
    let repaired = 0;
    for (const job of candidates) {
      if (job.location?.trim() && !isLocationCountLabel(job.location)) continue;
      const location = formatJobLocation(job.location, job.locations);
      if (!location || location === job.location || isLocationCountLabel(location)) continue;
      const record = tx.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
      const aiFingerprint = buildJobFingerprintFromRecord({ ...record, location });
      repaired += tx.update(jobs).set({ location, aiFingerprint }).where(eq(jobs.id, job.id)).run().changes;
    }
    return repaired;
  }, { behavior: "immediate" });
}
