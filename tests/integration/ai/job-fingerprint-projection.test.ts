import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildJobFingerprintFromRecord,
} from "@/lib/ai/artifacts/fingerprints";
import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import { companies, jobs } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-job-fingerprint-projection-");

describe("job fingerprint projection", () => {
  it("backfills missing fingerprints without changing content timestamps", () => {
    const { database } = harness.createDatabase();
    const company = database.insert(companies).values({
      name: "Projection fixture",
      careersUrl: "https://example.com/careers",
    }).returning().get();
    const updatedAt = new Date("2026-07-01T00:00:00.000Z");
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Backend Engineer",
      description: "Build TypeScript services",
      url: "https://example.com/jobs/backend",
      locationType: "remote",
      employmentType: "full-time",
      updatedAt,
    }).returning().get();

    expect(ensureJobFingerprintProjection(database)).toEqual({
      updated: 1,
      skipped: 0,
    });
    const stored = database.select().from(jobs).get();
    expect(stored?.aiFingerprint).toBe(buildJobFingerprintFromRecord(job));
    expect(stored?.updatedAt).toEqual(updatedAt);
    expect(ensureJobFingerprintProjection(database)).toEqual({
      updated: 0,
      skipped: 0,
    });
  });
});
