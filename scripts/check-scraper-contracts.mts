/** Bounded, read-only checks using the real adapters. Never imports application storage. */
import { readFile } from "node:fs/promises";

import type { IBrowserClient } from "../lib/scraper/infrastructure/browser-client";
import { FetchHttpClient, HttpError, type IHttpClient } from "../lib/scraper/infrastructure/http-client";
import { createScraperRegistry } from "../lib/scraper/services/registry";
import { isPlatform, type Platform } from "../lib/scraper/types";
import { PLATFORMS } from "../lib/scraper/types/platform";

interface Target { name: string; platform: Platform; careersUrl: string; boardToken?: string; isActive?: boolean }
const presets = JSON.parse(await readFile(new URL("../public/companies.json", import.meta.url), "utf8")) as Target[];
const requested = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
for (const value of requested) if (!isPlatform(value)) throw new Error(`Unknown scraper platform: ${value}`);
const targets = PLATFORMS.filter((platform) => requested.size === 0 || requested.has(platform)).map((platform) =>
  platform === "mynexthire"
    ? { name: "GoldenSource", platform, careersUrl: "https://goldensource.mynexthire.com/employer/jobs" }
    : presets.find((target) => target.platform === platform && target.isActive !== false)
).filter((target): target is Target => Boolean(target));

const browser: IBrowserClient = {
  bootstrap: async () => { throw new Error("Contract check needs browser recovery; run the dedicated browser validation."); },
  withBrowser: async () => { throw new Error("Contract check needs browser recovery; run the dedicated browser validation."); },
  close: async () => undefined,
};
let failed = false;
for (const target of targets) {
  const transport = new FetchHttpClient({ timeout: 10_000, retries: 0, maxConcurrencyPerHost: 2 });
  let requests = 0;
  let budgetExhausted = false;
  const client: IHttpClient = {
    fetch: async (url, options) => {
      if (requests >= 4) { budgetExhausted = true; throw new Error("Contract-check request budget exhausted"); }
      requests++;
      return transport.fetch(url, { ...options, retries: 0 });
    },
    get: async <T,>(url: string, options?: Parameters<IHttpClient["fetch"]>[1]) => {
      const response = await client.fetch(url, options);
      if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status}`, url, response.headers);
      return await response.json() as T;
    },
    post: async <T,>(url: string, body: unknown, options?: Parameters<IHttpClient["fetch"]>[1]) => {
      return client.get<T>(url, { ...options, method: "POST", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...options?.headers } });
    },
  };
  const registry = createScraperRegistry({ httpClient: client, browserClient: browser });
  const result = await registry.scrape(target.careersUrl, target.platform, {
    boardToken: target.boardToken, signal: AbortSignal.timeout(20_000),
    filters: { titleKeywords: ["__switchy_contract_check_without_detail_downloads__"] },
  });
  const error = result.outcome === "error" ? result.error : undefined;
  const contractFailure = error && ["parse_error", "invalid_url", "board_not_found"].includes(error.code);
  if (contractFailure) failed = true;
  console.log(JSON.stringify({ platform: target.platform, requests, budgetExhausted,
    status: contractFailure ? "contract_failure" : error ? "inconclusive" : "compatible_sample",
    outcome: result.outcome, listingCompleteness: result.listingCompleteness,
    listings: result.outcome === "error" ? undefined : result.totalListings,
    issueCodes: result.outcome === "error" ? [result.error.code] : [...new Set(result.issues?.map((issue) => issue.code) ?? [])],
  }));
}
process.exitCode = failed ? 1 : 0;
