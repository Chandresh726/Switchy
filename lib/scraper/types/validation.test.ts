import { describe, expect, it } from "vitest";
import { z } from "zod";

import { HttpError } from "@/lib/scraper/infrastructure/http-client";
import {
  createFailureFromUnknown,
  parseExternalPayload,
  ScraperPayloadError,
} from "@/lib/scraper/types";

describe("scraper payload validation", () => {
  it("reports a concise source-aware validation error", () => {
    expect(() =>
      parseExternalPayload(
        z.object({ jobs: z.array(z.object({ id: z.string() })) }),
        { jobs: [{ id: 42 }] },
        "Example"
      )
    ).toThrow(ScraperPayloadError);
  });

  it.each([
    [401, "auth_required", false],
    [408, "timeout", true],
    [429, "rate_limited", true],
    [503, "network_error", true],
    [403, "auth_required", false],
    [404, "board_not_found", false],
  ] as const)("classifies HTTP %s as %s", (status, code, retryable) => {
    expect(
      createFailureFromUnknown(new HttpError(status, `HTTP ${status}`, "https://example.com"))
    ).toMatchObject({
      outcome: "error",
      error: { code, retryable, statusCode: status },
    });
  });
});
