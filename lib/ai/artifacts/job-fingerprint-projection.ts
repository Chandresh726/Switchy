import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

import { buildJobFingerprintFromRecord } from "./fingerprints";

interface ProjectionResult {
  updated: number;
  skipped: number;
}

type FingerprintJob = Pick<
  typeof jobs.$inferSelect,
  | "id"
  | "title"
  | "description"
  | "location"
  | "locationType"
  | "seniorityLevel"
  | "department"
  | "employmentType"
  | "salary"
>;

function fingerprintJob(job: FingerprintJob): string | null {
  try {
    return buildJobFingerprintFromRecord(job);
  } catch {
    return null;
  }
}

export function ensureJobFingerprintProjection(
  database: typeof db = db,
  jobIds?: number[]
): ProjectionResult {
  if (jobIds && jobIds.length === 0) return { updated: 0, skipped: 0 };

  const selection = {
    id: jobs.id,
    title: jobs.title,
    description: jobs.description,
    location: jobs.location,
    locationType: jobs.locationType,
    seniorityLevel: jobs.seniorityLevel,
    department: jobs.department,
    employmentType: jobs.employmentType,
    salary: jobs.salary,
  } as const;
  const rows: FingerprintJob[] = [];
  if (jobIds) {
    for (const batch of chunkSqliteParameters(jobIds)) {
      rows.push(...database.select(selection).from(jobs).where(and(
        isNull(jobs.aiFingerprint),
        inArray(jobs.id, batch)
      )).all());
    }
  } else {
    rows.push(...database.select(selection)
      .from(jobs)
      .where(isNull(jobs.aiFingerprint))
      .all());
  }
  if (rows.length === 0) return { updated: 0, skipped: 0 };

  return database.transaction((tx) => {
    let updated = 0;
    let skipped = 0;
    for (const job of rows) {
      const fingerprint = fingerprintJob(job);
      if (!fingerprint) {
        skipped++;
        continue;
      }
      updated += tx.update(jobs)
        .set({ aiFingerprint: fingerprint })
        .where(and(eq(jobs.id, job.id), isNull(jobs.aiFingerprint)))
        .run().changes;
    }
    return { updated, skipped };
  }, { behavior: "immediate" });
}
