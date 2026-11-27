import { resolveListingCompleteness } from "./completeness";
import type { ListingQueryOptimizer } from "./query-optimizer";

interface ListingPage<T> {
  ok: true;
  offset: number;
  limit: number;
  totalJobs: number;
  listings: T[];
  invalidListings: number;
}
interface FailedPage {
  ok: false;
  offset: number;
  status?: number;
  error?: unknown;
}

async function fetchOracleListingPages<T extends { id: string }>(options: {
  fetchPage: (offset: number) => Promise<ListingPage<T> | FailedPage>;
  maxPages: number;
  overlapRatio: number;
}) {
  const first = await options.fetchPage(0);
  if (!first.ok) return { listings: [] as T[], advertisedTotal: 0, failedOffsets: [first],
    invalidListings: 0, truncated: false, isComplete: false };
  const overlap = first.limit >= 50 ? Math.min(20, Math.ceil(first.limit * options.overlapRatio)) : 0;
  const stride = Math.max(1, first.limit - overlap);
  const required = first.totalJobs <= first.limit ? 1 : 1 + Math.ceil((first.totalJobs - first.limit) / stride);
  const pages = await Promise.all(Array.from({ length: Math.max(0, Math.min(required, options.maxPages) - 1) },
    (_, index) => options.fetchPage(first.offset + (index + 1) * stride)));
  const successes = [first, ...pages.filter((page): page is ListingPage<T> => page.ok)]
    .sort((a, b) => a.offset - b.offset);
  const failedOffsets = pages.filter((page): page is FailedPage => !page.ok);
  const listings = [...new Map(successes.flatMap((page) => page.listings).map((job) => [job.id, job])).values()];
  const advertisedTotal = Math.max(...successes.map((page) => page.totalJobs));
  const last = successes.at(-1)!;
  const truncated = required > options.maxPages ||
    (failedOffsets.length === 0 && last.offset + last.limit < advertisedTotal);
  const { isComplete } = resolveListingCompleteness(new Set(listings.map((job) => job.id)).size, advertisedTotal);
  return { listings, advertisedTotal, failedOffsets, truncated,
    invalidListings: successes.reduce((count, page) => count + page.invalidListings, 0),
    isComplete: failedOffsets.length === 0 && !truncated && isComplete };
}

export interface OracleQueryFilters {
  location?: string;
  selectedWorkplaceTypesFacet?: string;
}

export async function fetchOptimizedOracleListings<T extends { id: string; location?: string }>(options: {
  platform: "oracle" | "uber";
  source: string;
  board: string;
  country?: string;
  queries?: ListingQueryOptimizer;
  fetchPage: (offset: number, filters?: OracleQueryFilters) => Promise<ListingPage<T> | FailedPage>;
  maxPages: number;
  overlapRatio: number;
}) {
  const fetch = (filters?: OracleQueryFilters) => fetchOracleListingPages({
    ...options, fetchPage: (offset) => options.fetchPage(offset, filters),
  });
  const baseline = async () => {
    const value = await fetch();
    return { value, items: value.listings, complete: value.isComplete, advertisedTotal: value.advertisedTotal };
  };
  if (!options.queries || !options.country || /[,;=]/.test(options.country) || new URL(options.source).search) {
    return { ...(await baseline()).value, listingScopeKey: undefined };
  }
  const result = await options.queries.fetch({
    platform: options.platform, source: options.source, board: options.board, country: options.country,
    minimumItems: 201, candidateKey: { remote: "ORA_REMOTE", version: 1 }, baseline,
    candidate: async () => {
      // Country-qualified and unrestricted remote jobs remain separate queries.
      const pages = await Promise.all([
        fetch({ location: options.country }),
        fetch({ selectedWorkplaceTypesFacet: "ORA_REMOTE" }),
      ]);
      const listings = [...new Map(pages.flatMap((page) => page.listings).map((job) => [job.id, job])).values()];
      const complete = pages.every((page) => page.isComplete &&
        new Set(page.listings.map((job) => job.id)).size >= page.advertisedTotal);
      const value = {
        listings, advertisedTotal: complete ? listings.length : pages.reduce((sum, page) => sum + page.advertisedTotal, 0),
        failedOffsets: pages.flatMap((page) => page.failedOffsets),
        invalidListings: pages.reduce((sum, page) => sum + page.invalidListings, 0),
        truncated: pages.some((page) => page.truncated), isComplete: complete,
      };
      return { value, items: listings, complete, advertisedTotal: value.advertisedTotal };
    },
    getId: (job) => job.id, toFilterable: (job) => job,
  });
  return { ...result.value, listingScopeKey: result.listingScopeKey };
}

export function createOracleListingUrl(origin: string, site: string, limit: number, offset: number, filters: OracleQueryFilters = {}): string {
  const url = new URL("/hcmRestApi/resources/latest/recruitingCEJobRequisitions", origin);
  url.searchParams.set("onlyData", "true");
  url.searchParams.set("expand", "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations");
  url.searchParams.set("finder", `findReqs;${[
    `siteNumber=${site}`,
    "facetsList=WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS;LOCATIONS",
    `limit=${Math.min(200, Math.max(1, Math.floor(limit)))}`, `offset=${offset}`, "sortBy=POSTING_DATES_DESC",
    ...Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`),
  ].join(",")}`);
  return url.toString();
}
