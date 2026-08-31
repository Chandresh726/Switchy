import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import { FetchHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createScraperRegistry } from "@/lib/scraper/services/registry";
import type { JobFilters, Platform } from "@/lib/scraper/types";

interface ValidationTarget {
  company: string;
  url: string;
  platform: Platform;
  boardToken: string;
  filters?: JobFilters;
}

const TARGETS: ValidationTarget[] = [
  {
    company: "Nutanix",
    url: "https://jobs.jobvite.com/nutanix/jobs",
    platform: "jobvite",
    boardToken: "nutanix",
  },
  {
    company: "LegalZoom",
    url: "https://jobs.jobvite.com/legalzoom/jobs",
    platform: "jobvite",
    boardToken: "legalzoom",
  },
  {
    company: "Intuit",
    url: "https://jobs.intuit.com/search-jobs",
    platform: "talentbrew",
    boardToken: "27595",
    filters: { city: "Bangalore" },
  },
  {
    company: "Goldman Sachs",
    url: "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs",
    platform: "oracle",
    boardToken: "hdpc.fa.us2.oraclecloud.com/CX_3002",
    filters: { city: "Bengaluru" },
  },
  {
    company: "eBay",
    url: "https://jobs.ebayinc.com/us/en/search-results",
    platform: "phenom",
    boardToken: "EBAEBAUS",
    filters: { city: "Bengaluru" },
  },
  {
    company: "Texas Instruments",
    url: "https://careers.ti.com/en/sites/CX/jobs",
    platform: "oracle",
    boardToken: "careers.ti.com/CX",
    filters: { city: "Bengaluru" },
  },
  {
    company: "Oracle",
    url: "https://careers.oracle.com/en/sites/jobsearch/jobs",
    platform: "oracle",
    boardToken: "careers.oracle.com/CX_45001",
    filters: { city: "Bengaluru" },
  },
  {
    company: "JPMorgan Chase",
    url: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions",
    platform: "oracle",
    boardToken: "jpmc.fa.oraclecloud.com/CX_1001",
    filters: { city: "Bengaluru" },
  },
  {
    company: "BNY",
    url: "https://eofe.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/BNY-Careers/jobs",
    platform: "oracle",
    boardToken: "eofe.fa.us2.oraclecloud.com/CX_3001",
    filters: { city: "Pune" },
  },
  {
    company: "Cisco",
    url: "https://careers.cisco.com/global/en/search-results",
    platform: "phenom",
    boardToken: "CISCISGLOBAL",
    filters: {
      city: "Mumbai",
      titleKeywords: ["Solutions Development Architect"],
    },
  },
  {
    company: "Splunk",
    url: "https://careers.cisco.com/global/en/splunk/search-page",
    platform: "phenom",
    boardToken: "CISCISGLOBAL",
    filters: { city: "Pune" },
  },
];

const unusedBrowserClient: IBrowserClient = {
  bootstrap: async () => {
    throw new Error("Live reusable ATS validation must not use a browser.");
  },
  withBrowser: async () => {
    throw new Error("Live reusable ATS validation must not use a browser.");
  },
  close: async () => undefined,
};

const registry = createScraperRegistry({
  httpClient: new FetchHttpClient({
    timeout: 45_000,
    retries: 3,
    baseDelay: 1_000,
    maxConcurrencyPerHost: 5,
  }),
  browserClient: unusedBrowserClient,
});

let failed = false;
const requestedCompanies = new Set(
  process.argv.slice(2).map((value) => value.trim().toLowerCase()).filter(Boolean)
);
const targets = requestedCompanies.size === 0
  ? TARGETS
  : TARGETS.filter((target) => requestedCompanies.has(target.company.toLowerCase()));
if (targets.length === 0) {
  throw new Error(`No validation target matched: ${Array.from(requestedCompanies).join(", ")}`);
}

for (const target of targets) {
  const startedAt = Date.now();
  const result = await registry.scrape(target.url, target.platform, {
    filters: target.filters,
  });
  const externalIds = result.outcome === "error" ? [] : result.openExternalIds ?? [];
  const uniqueExternalIds = new Set(externalIds);
  const sample = result.jobs.slice(0, 3);
  const errors: string[] = [];

  if (result.outcome !== "success") {
    errors.push(
      result.outcome === "error"
        ? `${result.error.code}: ${result.error.message}`
        : result.issues?.map((issue) => issue.message).join("; ") || "partial result"
    );
  }
  if (result.listingCompleteness !== "complete") errors.push("listing is not complete");
  if (result.outcome !== "error" && result.totalListings <= 0) errors.push("board is empty");
  if (result.outcome !== "error" && result.jobs.length === 0) {
    errors.push("filters returned no jobs to validate");
  }
  if (
    result.outcome !== "error" &&
    result.detectedBoardToken !== target.boardToken
  ) {
    errors.push(
      `detected board token ${result.detectedBoardToken ?? "<missing>"} did not match ${target.boardToken}`
    );
  }
  if (uniqueExternalIds.size !== externalIds.length) errors.push("external IDs are not unique");
  if (
    result.outcome !== "error" &&
    result.listingCompleteness === "complete" &&
    externalIds.length !== result.totalListings
  ) {
    errors.push("open external-ID count does not match the listing count");
  }
  for (const job of sample) {
    if (!job.externalId || !job.title.trim()) errors.push("sample job has no identity or title");
    if (!job.description?.trim()) errors.push(`${job.externalId} has no description`);
    try {
      new URL(job.url);
    } catch {
      errors.push(`${job.externalId} has an invalid URL`);
    }
  }

  const summary = {
    company: target.company,
    platform: target.platform,
    boardToken: target.boardToken,
    outcome: result.outcome,
    listingCompleteness: result.listingCompleteness,
    totalListings: result.outcome === "error" ? 0 : result.totalListings,
    returnedJobs: result.jobs.length,
    durationMs: Date.now() - startedAt,
    errors,
  };
  console.log(JSON.stringify(summary));
  failed ||= errors.length > 0;
}

if (failed) process.exitCode = 1;
