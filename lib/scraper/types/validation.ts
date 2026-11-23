import type { z } from "zod";

import { BrowserSessionBootstrapError } from "@/lib/scraper/infrastructure/browser-session-error";
import { HttpError } from "@/lib/scraper/infrastructure/http-client";

import {
  createScraperFailure,
  type ScraperErrorCode,
  type ScraperErrorResult,
} from "./result";

export class ScraperPayloadError extends Error {
  constructor(
    public readonly source: string,
    details: string
  ) {
    super(`Invalid ${source} payload: ${details}`);
    this.name = "ScraperPayloadError";
  }
}

export function parseExternalPayload<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  source: string
): T {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  throw new ScraperPayloadError(source, details);
}

export interface ParsedExternalItems<T> {
  items: T[];
  invalidCount: number;
  invalidFields: string[];
}

export function parseExternalItems<T>(
  schema: z.ZodType<T>,
  payload: unknown[],
  source: string
): ParsedExternalItems<T> {
  const items: T[] = [];
  let invalidCount = 0;
  const invalidFields = new Set<string>();

  for (const item of payload) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      invalidCount++;
      for (const issue of parsed.error.issues) {
        // Record field names only, never payload values or validation messages.
        if (invalidFields.size < 3) invalidFields.add(issue.path.join(".") || "root");
      }
    }
  }

  if (payload.length > 0 && items.length === 0) {
    throw new ScraperPayloadError(source, `no usable items were found; invalid fields: ${[...invalidFields].join(", ")}`);
  }

  return { items, invalidCount, invalidFields: [...invalidFields] };
}

export function createFailureFromUnknown(error: unknown): ScraperErrorResult {
  if (error instanceof BrowserSessionBootstrapError) {
    return createScraperFailure("browser_error", error.message);
  }

  if (error instanceof ScraperPayloadError) {
    return createScraperFailure("parse_error", error.message);
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    const isTimeout = /timed?\s*out/i.test(error.message);
    return createScraperFailure(
      isTimeout ? "timeout" : "cancelled",
      error.message || (isTimeout ? "Request timed out" : "Scrape cancelled")
    );
  }

  if (error instanceof HttpError) {
    if (error.isBrowserChallenge) {
      return createScraperFailure("browser_challenge", "Blocked by browser challenge", { statusCode: error.status });
    }
    return createFailureForHttpStatus(error.status, error.message, error.retryAfterMs);
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  const retryAfterMs = error instanceof Error && "retryAfterMs" in error &&
    typeof error.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs)
    ? Math.max(0, error.retryAfterMs) : undefined;
  if (error instanceof Error && "status" in error && typeof error.status === "number") {
    return createFailureForHttpStatus(error.status, message, retryAfterMs);
  }
  if (error instanceof Error) {
    if (/(?:rate limit|too many requests|tokens per|token limit|quota|throttl|(?:status|http|error)[:\s]*429)/i.test(message)) {
      return createScraperFailure("rate_limited", message, { retryAfterMs });
    }
    if (error.name === "ScrapeAbortError" || /timeout|timed\s*out/i.test(message)) {
      return createScraperFailure("timeout", message);
    }
    if (error instanceof TypeError || /econnreset|econnrefused|econnaborted|service unavailable/i.test(message)) {
      return createScraperFailure("network_error", message);
    }
  }
  return createScraperFailure("unknown", message);
}

function classifyHttpStatus(status: number): ScraperErrorCode {
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status === 401 || status === 403) return "auth_required";
  if (status === 404) return "board_not_found";
  if (status === 425 || (status >= 500 && status < 600)) return "network_error";
  return "unknown";
}

export function createFailureForHttpStatus(
  status: number,
  message: string,
  retryAfterMs?: number
): ScraperErrorResult {
  return createScraperFailure(classifyHttpStatus(status), message, {
    statusCode: status,
    retryAfterMs,
  });
}
