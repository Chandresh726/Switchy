import { describe, expect, it, vi } from "vitest";

import type { IScraper } from "@/lib/scraper/core/types";
import { runWithScrapeSignal } from "@/lib/scraper/infrastructure/cancellation";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  JobviteScraper,
  OracleScraper,
  PhenomScraper,
  TalentBrewScraper,
} from "@/lib/scraper/platforms";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

interface CancellationCase {
  platform: string;
  url: string;
  boardToken: string;
  createScraper: (client: IHttpClient) => IScraper;
}

const CASES: CancellationCase[] = [
  {
    platform: "jobvite",
    url: "https://jobs.jobvite.com/acme/jobs",
    boardToken: "acme",
    createScraper: (client) => new JobviteScraper(client),
  },
  {
    platform: "talentbrew",
    url: "https://jobs.intuit.com/search-jobs",
    boardToken: "27595",
    createScraper: (client) => new TalentBrewScraper(client),
  },
  {
    platform: "oracle",
    url: "https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs",
    boardToken: "example.fa.oraclecloud.com/CX_1",
    createScraper: (client) => new OracleScraper(client),
  },
  {
    platform: "phenom",
    url: "https://jobs.ebayinc.com/us/en/search-results",
    boardToken: "EBAEBAUS",
    createScraper: (client) => new PhenomScraper(client),
  },
];

describe("reusable HTTP scraper cancellation", () => {
  it.each(CASES)("propagates cancellation through $platform requests", async (entry) => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort(new DOMException("Cancelled by test", "AbortError"));
      throw controller.signal.reason;
    });
    const scraper = entry.createScraper(
      createHttpClientStub({ fetch: fetchMock })
    );

    const result = await runWithScrapeSignal(controller.signal, () =>
      scraper.scrape(entry.url, { boardToken: entry.boardToken })
    );

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "cancelled", retryable: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
