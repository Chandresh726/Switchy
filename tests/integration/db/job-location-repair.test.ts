import { describe, expect, it } from "vitest";

import { migrateLocalDatabase } from "@/lib/db/migrations";
import { repairPlaceholderJobLocations } from "@/lib/db/job-location-repair";
import { buildJobFingerprintFromRecord } from "@/lib/ai/artifacts/fingerprints";
import { companies, jobs } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const sqlite = createSqliteTestHarness("switchy-location-repair-");

describe("stored job location repair", () => {
  it("repairs only placeholders with known names during upgrades and preserves all other job state", () => {
    const { database } = sqlite.createDatabase();
    const company = database.insert(companies).values({ name: "Locations", careersUrl: "https://example.com" }).returning().get();
    const before = database.insert(jobs).values([
      { companyId: company.id, title: "Repair", url: "https://example.com/repair", location: "2 Locations",
        sourceLocations: ["New Delhi", "Mumbai"], status: "applied", appliedAt: new Date("2026-01-01"), detailsFetchedAt: new Date("2026-01-02") },
      { companyId: company.id, title: "Unknown", url: "https://example.com/unknown", location: "2 Locations" },
      { companyId: company.id, title: "Actual", url: "https://example.com/actual", location: "New Delhi", sourceLocations: ["New Delhi", "Mumbai"] },
      { companyId: company.id, title: "Empty", url: "https://example.com/empty", location: null, sourceLocations: ["Hyderabad", "Bangalore"] },
    ]).returning().all();
    migrateLocalDatabase(database, `${process.cwd()}/drizzle`);
    expect(database.select().from(jobs).all()).toEqual(before.map((job) => {
      const location = job.title === "Repair" ? "New Delhi; Mumbai" : job.title === "Empty" ? "Hyderabad; Bangalore" : job.location;
      return { ...job, location, aiFingerprint: location === job.location ? job.aiFingerprint
        : buildJobFingerprintFromRecord({ ...job, location }) };
    }));
    expect(repairPlaceholderJobLocations(database)).toBe(0);
  });
});
