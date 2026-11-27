import { z } from "zod";

import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";
import { HttpError } from "@/lib/scraper/infrastructure/http-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";

import { resolveListingCompleteness } from "../shared/completeness";

import { WORKDAY_PAGE_SIZE } from "./config";
import { canonicalWorkdayScope, readWorkdayFacets } from "./country-filter";
import { WorkdayListError } from "./listing-error";
import { WorkdayJobListItemSchema, type WorkdayJobListItem, type WorkdayJobListResponse, type WorkdayListFetchResult, type WorkdaySource } from "./payloads";

export async function crawlWorkdayListings({ source, request, state, initialPage, parallelListFetches, queryResultLimit, getId }: {
  source: WorkdaySource;
  request: (offset: number) => Promise<WorkdayJobListResponse>;
  state?: ScrapeFetchStateStore;
  initialPage?: WorkdayJobListResponse;
  parallelListFetches: number;
  queryResultLimit: number;
  getId: (job: WorkdayJobListItem) => string | null;
}): Promise<WorkdayListFetchResult | WorkdayListError> {
  const key = `workday-pages:${canonicalWorkdayScope(source)}`;
  const checkpointSchema = z.object({
    createdAt: z.number(), total: z.number(),
    pages: z.array(z.tuple([z.number().int().nonnegative(), z.object({
      total: z.number(), jobPostings: z.array(WorkdayJobListItemSchema),
      invalidCount: z.number(), invalidFields: z.array(z.string()),
      facets: z.array(z.unknown()).optional().transform((value) => readWorkdayFacets(value)),
    })])),
  });
  const saved = checkpointSchema.safeParse(state?.get(key));
  const pages = new Map<number, WorkdayJobListResponse>();
  const diagnostics: string[] = [];
  const startedAt = Date.now();
  let firstBatch: WorkdayJobListResponse;
  try {
    firstBatch = initialPage ?? await request(0);
  } catch (error) {
    if (error instanceof WorkdayListError) return error;
    throw error;
  }
  const total = firstBatch.total || 0;
  const capped = total >= queryResultLimit;
  if (capped) diagnostics.push(`Query reached the ${queryResultLimit}-result ceiling; complete coverage is unverified`);
  const inconsistentTotal = total < firstBatch.jobPostings.length;
  if (inconsistentTotal) diagnostics.push("First-page total was smaller than the returned listing count");
  const checkpoint = saved.success && saved.data.total === total &&
    startedAt - saved.data.createdAt < 15 * 60_000 ? saved.data : null;
  if (checkpoint) {
    for (const [offset, page] of checkpoint.pages) pages.set(offset, page);
  }
  const resumed = pages.size > 0;
  const createdAt = checkpoint?.createdAt ?? startedAt;
  pages.set(0, firstBatch);
  const persist = () => state?.set(key, {
    createdAt, total, pages: Array.from(pages.entries()),
  }, new Date(createdAt + 15 * 60_000));
  persist();

  const missingOffsets = new Set<number>();
  for (let offset = 0; offset < Math.min(total, queryResultLimit); offset += WORKDAY_PAGE_SIZE) {
    const page = pages.get(offset);
    if (!page || page.jobPostings.length < Math.min(WORKDAY_PAGE_SIZE, total - offset)) {
      missingOffsets.add(offset);
    }
  }
  let consecutiveFailures = 0;
  let repeatedPage = false;
  const fingerprints = new Map<string, number>();
  for (const [offset, page] of pages) {
    if (page.jobPostings.length) fingerprints.set(JSON.stringify(page.jobPostings.map((job) => job.externalPath).sort()), offset);
  }
  // One recovery pass for isolated failures; sustained failures stop the sweep.
  for (let pass = 0; pass < 2; pass++) {
    const offsets = [...missingOffsets];
    let stopped = false;
    for (let index = 0; index < offsets.length; index += parallelListFetches) {
      if (consecutiveFailures >= 3 || Date.now() - startedAt > 15 * 60_000) {
        diagnostics.push("Listing sweep stopped at its failure or time budget");
        stopped = true;
        break;
      }
      const batch = offsets.slice(index, index + parallelListFetches);
      const results = await Promise.all(batch.map(async (offset) => {
        try {
          return { offset, page: await request(offset) };
        } catch (error) {
          throwIfScrapeAborted(error);
          return { offset, error };
        }
      }));
      // Save successful peers before propagating a throttle or bootstrap error.
      for (const result of results) {
        if (result.page) {
          const fingerprint = JSON.stringify(result.page.jobPostings.map((job) => job.externalPath).sort());
          const previousOffset = fingerprints.get(fingerprint);
          if (result.page.jobPostings.length && previousOffset !== undefined && previousOffset !== result.offset) {
            repeatedPage = true;
            diagnostics.push(`Repeated listing page at offsets ${previousOffset} and ${result.offset}; pagination stopped`);
            continue;
          }
          if (result.page.jobPostings.length) fingerprints.set(fingerprint, result.offset);
          pages.set(result.offset, result.page);
          consecutiveFailures = 0;
          if (result.page.jobPostings.length >= Math.min(WORKDAY_PAGE_SIZE, total - result.offset)) {
            missingOffsets.delete(result.offset);
          }
        } else {
          consecutiveFailures++;
          const error = result.error;
          diagnostics.push(error instanceof WorkdayListError ? error.describe() : "Listing page request failed");
        }
      }
      persist();
      const fatal = results.find(({ error }) => error instanceof WorkdayListError &&
        (error.status === 429 || error.stage === "bootstrap" ||
          (error.cause instanceof HttpError && error.cause.isBrowserChallenge)));
      if (fatal?.error) {
        if (fatal.error instanceof WorkdayListError && fatal.error.cause instanceof HttpError &&
          fatal.error.cause.isBrowserChallenge) throw fatal.error.cause;
        if (fatal.error instanceof WorkdayListError && fatal.error.status === 429 && state) {
          return fatal.error;
        }
        if (fatal.error instanceof WorkdayListError && fatal.error.stage === "bootstrap") throw fatal.error;
        stopped = true;
        break;
      }
      if (repeatedPage) { stopped = true; break; }
    }
    if (stopped) break;
  }

  const jobsById = new Map<string, WorkdayJobListItem>();
  for (const [offset, page] of pages) {
    for (const [index, job] of page.jobPostings.entries()) {
      const id = getId(job);
      const identity = id ?? `unkeyed-${offset + index}`;
      jobsById.set(id ? `id:${id}` : `offset:${offset + index}`, { ...job, listingIdentity: identity });
    }
  }
  const jobs = [...jobsById.values()];
  const invalidCount = [...pages.values()].reduce((sum, page) => sum + page.invalidCount, 0);
  const unidentifiedCount = jobs.filter((job) => !getId(job)).length;
  const { isComplete: countsComplete } = resolveListingCompleteness(jobs.length, total);
  // A checkpoint mixes snapshots. Keep archival disabled until a fresh complete sweep.
  const isComplete = !capped && !inconsistentTotal && !repeatedPage && !resumed && missingOffsets.size === 0 && countsComplete &&
    invalidCount === 0 && unidentifiedCount === 0;
  if (missingOffsets.size === 0) state?.delete(key);
  return {
    jobs, isComplete, advertisedCount: total,
    missingOffsets: [...missingOffsets].sort((a, b) => a - b),
    unidentifiedCount, invalidCount,
    invalidFields: [...new Set([...pages.values()].flatMap((page) => page.invalidFields))].slice(0, 3),
    diagnostics: [...new Set(diagnostics)].slice(0, 3), resumed,
  };
}
