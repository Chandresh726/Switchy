import { describe, expect, it } from "vitest";

import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import { canArchiveMissingJobs } from "@/lib/scraper/services/listing-reconciliation";

const existing: ExistingJob[] = Array.from({ length: 20 }, (_, id) => ({
  id, externalId: `job-${id}`, title: "Engineer", url: `https://example.com/${id}`,
  status: "new", description: null,
}));

function fixture() {
  const values = new Map<string, unknown>();
  const state = { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); }, delete: (key: string) => { values.delete(key); } };
  return { companyId: 1, source: "board-a", complete: true, openIds: ["job-0"], existing,
    now: new Date("2026-11-26T10:00:00Z"), state };
}

describe("listing reconciliation", () => {
  it("requires two exact snapshots separated by a minute before a large archival", () => {
    const input = fixture();
    expect(canArchiveMissingJobs(input).allowed).toBe(false);
    expect(canArchiveMissingJobs(input).allowed).toBe(false);
    expect(canArchiveMissingJobs({ ...input, now: new Date(input.now.getTime() + 60_000) }).allowed).toBe(true);
  });

  it("does not confirm a changed source, changed missing set, expired or interrupted snapshot", () => {
    for (const change of [{ source: "board-b" }, { openIds: ["job-0", "job-1"] },
      { now: new Date("2026-11-28T10:00:00Z") }]) {
      const input = fixture();
      canArchiveMissingJobs(input);
      expect(canArchiveMissingJobs({ ...input, now: new Date(input.now.getTime() + 120_000), ...change }).allowed).toBe(false);
    }
    const input = fixture();
    canArchiveMissingJobs(input);
    canArchiveMissingJobs({ ...input, complete: false });
    expect(canArchiveMissingJobs({ ...input, now: new Date(input.now.getTime() + 120_000) }).allowed).toBe(false);
  });

  it("allows a small disappearance and excludes applied jobs from the drop guard", () => {
    expect(canArchiveMissingJobs({ ...fixture(), openIds: existing.slice(0, 18).map((job) => job.externalId!) }).allowed).toBe(true);
    expect(canArchiveMissingJobs({ ...fixture(), existing: existing.map((job) => ({ ...job, status: "applied" })) }).allowed).toBe(true);
  });
});
