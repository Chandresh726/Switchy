import type { AdaptivePacingOptions } from "@/lib/scraper/infrastructure/host-request-pacer";
import type { BrowserScraperConfig } from "@/lib/scraper/types";
import { DEFAULT_BROWSER_CONFIG } from "@/lib/scraper/types/config";

import { DEFAULT_WORKDAY_COUNTRY_POLICY, type WorkdayBoardPolicy, type WorkdayCountryPolicy } from "./country-filter";

export const WORKDAY_PAGE_SIZE = 20;

export type WorkdayConfig = BrowserScraperConfig & {
  parallelListFetches: number;
  detailBatchSize: number;
  /** Minimum interval between request starts, not an unconditional page delay. */
  listDelayMs: number;
  adaptivePacing: AdaptivePacingOptions;
  countryFilter: WorkdayCountryPolicy;
  boardPolicies: readonly WorkdayBoardPolicy[];
  queryResultLimit: number;
};

export type WorkdayConfigInput = Partial<Omit<WorkdayConfig, "countryFilter" | "adaptivePacing">> & {
  countryFilter?: Partial<WorkdayCountryPolicy>;
  adaptivePacing?: Partial<AdaptivePacingOptions>;
};

export const DEFAULT_WORKDAY_CONFIG: WorkdayConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  parallelListFetches: 1,
  detailBatchSize: 1,
  listDelayMs: 1_500,
  adaptivePacing: { maxIntervalMs: 12_000, recoverySuccesses: 5 },
  countryFilter: DEFAULT_WORKDAY_COUNTRY_POLICY,
  boardPolicies: [],
  queryResultLimit: 2_000,
};
