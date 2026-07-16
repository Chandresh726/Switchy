import { describe, expect, it } from "vitest";

import { fetchJobsData } from "@/lib/ai/matcher/tracking/session";
import { fetchCompanyJobIds } from "@/lib/ai/work-items/job-selection";
import { companies, jobs } from "@/lib/db/schema";
import { DEFAULT_SQLITE_PARAMETER_CHUNK_SIZE } from "@/lib/db/sqlite-utils";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-match-query-chunking-");

describe("large match query selection", () => {
  it("fetches jobs and company selections beyond one SQLite parameter chunk", async () => {
    const { database } = harness.createDatabase();
    const count = DEFAULT_SQLITE_PARAMETER_CHUNK_SIZE + 5;
    const companyIds: number[] = [];
    const jobIds: number[] = [];
    database.transaction((tx) => {
      for (let index = 0; index < count; index += 1) {
        const company = tx.insert(companies).values({
          name: `Chunk company ${index}`,
          careersUrl: `https://example.test/${index}`,
        }).returning({ id: companies.id }).get();
        const job = tx.insert(jobs).values({
          companyId: company.id,
          title: `Chunk role ${index}`,
          url: `https://example.test/${index}/role`,
        }).returning({ id: jobs.id }).get();
        companyIds.push(company.id);
        jobIds.push(job.id);
      }
    });

    const selectedJobIds = await fetchCompanyJobIds(companyIds, database);
    const fetchedJobs = await fetchJobsData(jobIds, database);

    expect(selectedJobIds).toHaveLength(count);
    expect(new Set(selectedJobIds)).toEqual(new Set(jobIds));
    expect(fetchedJobs.size).toBe(count);
    expect(fetchedJobs.get(jobIds.at(-1)!)).toMatchObject({
      title: `Chunk role ${count - 1}`,
    });
  });
});
