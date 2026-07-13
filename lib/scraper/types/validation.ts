import type { z } from "zod";

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

export function createFailureFromUnknown(error: unknown): ScraperErrorResult {
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
    return createFailureForHttpStatus(error.status, error.message);
  }

  if (error instanceof TypeError) {
    return createScraperFailure("network_error", error.message);
  }

  return createScraperFailure(
    "unknown",
    error instanceof Error ? error.message : "Unknown error"
  );
}

export function classifyHttpStatus(status: number): ScraperErrorCode {
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status === 401 || status === 403) return "auth_required";
  if (status === 404) return "board_not_found";
  if (status >= 500) return "network_error";
  return "unknown";
}

export function createFailureForHttpStatus(
  status: number,
  message: string
): ScraperErrorResult {
  return createScraperFailure(classifyHttpStatus(status), message, {
    statusCode: status,
  });
}
