import { describe, expect, it } from "vitest";
import { z } from "zod";

import { HttpError } from "@/lib/scraper/infrastructure/http-client";
import { BrowserSessionBootstrapError } from "@/lib/scraper/infrastructure/browser-client";
import {
  createFailureFromUnknown,
  parseExternalItems,
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

  it("retains valid items when only part of a collection is malformed", () => {
    expect(
      parseExternalItems(
        z.object({ id: z.string() }),
        [{ id: "valid" }, { id: 42 }],
        "Example items"
      )
    ).toEqual({ items: [{ id: "valid" }], invalidCount: 1 });
  });

  it("rejects a non-empty collection with no usable items", () => {
    expect(() =>
      parseExternalItems(
        z.object({ id: z.string() }),
        [{ id: 42 }],
        "Example items"
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

  it("distinguishes user cancellation from request timeout", () => {
    expect(
      createFailureFromUnknown(new DOMException("Scrape cancelled", "AbortError"))
    ).toMatchObject({ error: { code: "cancelled", retryable: false } });
    expect(
      createFailureFromUnknown(new DOMException("Request timed out", "AbortError"))
    ).toMatchObject({ error: { code: "timeout", retryable: true } });
  });

  it("maps sanitized browser-session failures to retryable scraper errors", () => {
    expect(
      createFailureFromUnknown(
        new BrowserSessionBootstrapError("session_extraction")
      )
    ).toMatchObject({
      outcome: "error",
      error: {
        code: "browser_error",
        retryable: true,
        message: "Failed to establish browser session during session extraction.",
      },
    });
  });
});
