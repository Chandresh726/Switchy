import { createHash } from "node:crypto";

import { z } from "zod";

import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";
import { HttpError } from "@/lib/scraper/infrastructure/http-client";
import { matchesPreferredCountry } from "@/lib/scraper/services/filter-service";
import type { FilterableItem } from "@/lib/scraper/services/early-filter-service";
import type { Platform } from "@/lib/scraper/types";
import { createFailureFromUnknown } from "@/lib/scraper/types/validation";

export interface ListingQueryPolicy {
  enabled: boolean;
  pageSize?: number;
  countryFilter: boolean;
  validationTtlMs: number;
  /** Avoid extra discovery calls on boards already returned in one page. */
  minimumCountryListings?: number;
}

export interface ListingQueryPolicies {
  platforms?: { [P in QueryPlatform]?: PolicyOverride<P> };
  boards?: Array<{ [P in QueryPlatform]: {
    platform: P;
    hostname: string;
    board?: string;
    policy: PolicyOverride<P>;
  } }[QueryPlatform]>;
}

type QueryPlatform = "talentbrew" | "lever" | "oracle" | "uber" | "smartrecruiters" | "eightfold" | "rippling";
type PolicyOverride<P extends QueryPlatform> = Partial<ListingQueryPolicy> & (P extends "eightfold" ? { pageSize?: never } : unknown);

export interface QuerySnapshot<T, R> {
  items: readonly T[];
  /** Fresh and complete enough to archive missing jobs. */
  complete: boolean;
  /** Every page was read, possibly from a recent checkpoint: enough to validate a country filter. */
  pagesComplete?: boolean;
  advertisedTotal?: number | null;
  value: R;
}

const validationSchema = z.object({ valid: z.boolean(), count: z.number().int().nonnegative().optional() });
const DEFAULT_POLICY: ListingQueryPolicy = {
  enabled: true,
  countryFilter: true,
  validationTtlMs: 7 * 24 * 60 * 60_000,
};
const REJECTION_TTL_MS = 24 * 60 * 60_000;
/** Large boards shift while they are paged, so a country check tolerates a small listing gap. */
const MIN_BASELINE_COVERAGE = 0.95;
const MAX_DRIFT_CHECKS = 5;
/** A proven query whose results collapse is rechecked; small boards swing too much to judge. */
const REVALIDATE_BELOW_SHARE = 0.5;
const REVALIDATE_MIN_COUNT = 10;

export function queryScope(platform: Platform, source: string, parameters: unknown): string {
  const url = new URL(source);
  url.hash = "";
  url.searchParams.sort();
  return createHash("sha256").update(JSON.stringify([platform, url.toString(), parameters])).digest("hex");
}

/** Country names come from the saved preference; API codes use ISO alpha-2. */
export function countryCode(country?: string): string | undefined {
  const codes: Record<string, string> = {
    india: "in", "united states": "us", usa: "us", "united kingdom": "gb", uk: "gb",
    germany: "de", canada: "ca", australia: "au", singapore: "sg", france: "fr",
  };
  if (!country?.trim()) return undefined;
  const normalized = country.trim().toLowerCase();
  if (codes[normalized]) return codes[normalized];
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      if (names.of(code)?.toLowerCase() === normalized) return code.toLowerCase();
    }
  }
  return undefined;
}

export class ListingQueryOptimizer {
  constructor(
    private readonly state?: ScrapeFetchStateStore,
    private readonly policies: ListingQueryPolicies = {}
  ) {}

  policy(platform: QueryPlatform, source: string, board?: string): ListingQueryPolicy {
    const hostname = new URL(source).hostname;
    const overrides = this.policies.boards?.filter((entry) =>
      entry.platform === platform && entry.hostname.toLowerCase() === hostname &&
      (!entry.board || entry.board === board)
    ).sort((a, b) => Number(Boolean(a.board)) - Number(Boolean(b.board))) ?? [];
    const policy = overrides.reduce((value, entry) => ({ ...value, ...entry.policy }), {
      ...DEFAULT_POLICY, ...this.policies.platforms?.[platform],
    });
    return {
      ...policy,
      validationTtlMs: Number.isFinite(policy.validationTtlMs)
        ? Math.max(0, policy.validationTtlMs) : DEFAULT_POLICY.validationTtlMs,
    };
  }

  async fetch<T, R>(input: {
    platform: QueryPlatform;
    source: string;
    board?: string;
    country?: string;
    /** Include request semantics/version, never a mutable result count. */
    candidateKey: unknown;
    minimumItems?: number;
    baseline: () => Promise<QuerySnapshot<T, R>>;
    candidate: (baseline?: QuerySnapshot<T, R>) => Promise<QuerySnapshot<T, R> | null>;
    getId: (item: T) => string | number;
    toFilterable: (item: T) => FilterableItem;
    /** Whether a job the candidate lacks is still open; undefined when it cannot be determined. */
    isStillOpen?: (item: T) => Promise<boolean | undefined>;
  }): Promise<{ value: R; listingScopeKey?: string }> {
    const policy = this.policy(input.platform, input.source, input.board);
    const base = async () => (await input.baseline()).value;
    if (!policy.enabled || (input.country && !policy.countryFilter)) return { value: await base() };
    const scope = queryScope(input.platform, input.source, [input.board, input.country, input.candidateKey]);
    const key = `listing-query-validation:${scope}`;
    let cached: z.infer<typeof validationSchema> | undefined;
    try { cached = validationSchema.safeParse(this.state?.get(key)).data; }
    catch { /* Revalidate an unavailable optional cache. */ }
    if (cached?.valid === false) return { value: await base() };
    const save = (valid: boolean, count?: number) => {
      const ttl = valid ? policy.validationTtlMs : Math.min(policy.validationTtlMs, REJECTION_TTL_MS);
      try { this.state?.set(key, { valid, count }, new Date(Date.now() + ttl)); }
      catch { /* Failure to cache may cost a future validation, never coverage. */ }
    };
    const uniqueIds = (snapshot: QuerySnapshot<T, R>) =>
      new Set(snapshot.items.map(input.getId)).size === snapshot.items.length;
    const exact = (snapshot: QuerySnapshot<T, R>) => snapshot.complete && uniqueIds(snapshot) &&
      (snapshot.advertisedTotal == null || snapshot.items.length >= snapshot.advertisedTotal);
    // Only a country subset tolerates drift; other candidates must match the board ID for ID.
    const coversBoard = (snapshot: QuerySnapshot<T, R>) => !input.country ? exact(snapshot) :
      (snapshot.pagesComplete ?? snapshot.complete) && uniqueIds(snapshot) &&
      (snapshot.advertisedTotal == null || snapshot.items.length >= snapshot.advertisedTotal * MIN_BASELINE_COVERAGE);
    let baseline: QuerySnapshot<T, R> | undefined;
    if (cached?.valid !== true) {
      baseline = await input.baseline();
      if (!coversBoard(baseline)) return { value: baseline.value };
      if (baseline.items.length < (policy.minimumCountryListings ?? input.minimumItems ?? 0)) {
        save(false);
        return { value: baseline.value };
      }
    }
    try {
      const candidate = await input.candidate(baseline);
      if (!candidate) {
        save(false);
        return { value: baseline?.value ?? await base() };
      }
      if (!baseline) {
        if (cached?.count && cached.count >= REVALIDATE_MIN_COUNT && candidate.complete &&
            candidate.items.length < cached.count * REVALIDATE_BELOW_SHARE) {
          try { this.state?.delete(key); } catch { /* The proof still expires on its TTL. */ }
          return { value: await base() };
        }
        return { value: candidate.value, listingScopeKey: input.country ? scope : undefined };
      }
      if (!exact(candidate)) return { value: baseline.value };
      const actual = new Set(candidate.items.map(input.getId));
      const expected = input.country ? baseline.items.filter((item) => {
        const value = input.toFilterable(item);
        return matchesPreferredCountry(value.country ?? value.location, input.country!);
      }) : baseline.items;
      const narrows = input.country ? actual.size < baseline.items.length
        : actual.size === new Set(baseline.items.map(input.getId)).size;
      const missing = expected.filter((item) => !actual.has(input.getId(item)));
      const verdict = !narrows ? "open" : await this.missingJobsVerdict(missing, input.isStillOpen);
      if (verdict === "open") save(false);
      if (verdict !== "closed") return { value: baseline.value };
      save(true, candidate.items.length);
      return { value: candidate.value, listingScopeKey: input.country ? scope : undefined };
    } catch (error) {
      throwIfScrapeAborted(error);
      const failure = createFailureFromUnknown(error).error;
      if (failure.code === "rate_limited" || failure.code === "browser_challenge") throw error;
      if (error instanceof HttpError && (error.status === 400 || error.status === 404)) save(false);
      return { value: baseline?.value ?? await base() };
    }
  }

  /** "closed" when every missing job has since closed, so the candidate still covers the board. */
  private async missingJobsVerdict<T>(
    missing: T[],
    isStillOpen?: (item: T) => Promise<boolean | undefined>
  ): Promise<"closed" | "open" | "unknown"> {
    if (missing.length === 0) return "closed";
    if (!isStillOpen || missing.length > MAX_DRIFT_CHECKS) return "open";
    let unknown = false;
    for (const item of missing) {
      const open = await isStillOpen(item);
      if (open === true) return "open";
      if (open === undefined) unknown = true;
    }
    return unknown ? "unknown" : "closed";
  }
}
