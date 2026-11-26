import { resolveListingCompleteness } from "./completeness";

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

export async function fetchOracleListingPages<T extends { id: string }>(options: {
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
  const listings = successes.flatMap((page) => page.listings);
  const advertisedTotal = Math.max(...successes.map((page) => page.totalJobs));
  const last = successes.at(-1)!;
  const truncated = required > options.maxPages ||
    (failedOffsets.length === 0 && last.offset + last.limit < advertisedTotal);
  const { isComplete } = resolveListingCompleteness(new Set(listings.map((job) => job.id)).size, advertisedTotal);
  return { listings, advertisedTotal, failedOffsets, truncated,
    invalidListings: successes.reduce((count, page) => count + page.invalidListings, 0),
    isComplete: failedOffsets.length === 0 && !truncated && isComplete };
}

export function createOracleListingUrl(origin: string, site: string, limit: number, offset: number): string {
  const url = new URL("/hcmRestApi/resources/latest/recruitingCEJobRequisitions", origin);
  url.searchParams.set("onlyData", "true");
  url.searchParams.set("expand", "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations");
  url.searchParams.set("finder", `findReqs;${[
    `siteNumber=${site}`,
    "facetsList=WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS;LOCATIONS",
    `limit=${limit}`, `offset=${offset}`, "sortBy=POSTING_DATES_DESC",
  ].join(",")}`);
  return url.toString();
}
