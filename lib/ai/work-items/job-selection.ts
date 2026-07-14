import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";

export async function fetchCompanyJobIds(
  companyIds: readonly number[],
  database: typeof db = db
): Promise<number[]> {
  const uniqueCompanyIds = Array.from(new Set(companyIds));
  const jobIds: number[] = [];
  for (const companyIdChunk of chunkSqliteParameters(uniqueCompanyIds)) {
    const rows = await database.select({ id: jobs.id }).from(jobs)
      .where(inArray(jobs.companyId, companyIdChunk));
    jobIds.push(...rows.map((row) => row.id));
  }
  return jobIds;
}
