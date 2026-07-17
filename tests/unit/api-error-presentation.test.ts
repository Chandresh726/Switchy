import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getApiErrorMessage,
  getApiErrorPresentation,
  isApiNotFoundError,
} from "@/lib/api/error-presentation";
import { APIClientError } from "@/lib/api/errors";

describe("API error presentation", () => {
  it("distinguishes not-found, conflict, invalid response, and network failures", () => {
    const notFound = new APIClientError("Job does not exist", 404, "not_found", undefined, "req-404");
    expect(getApiErrorPresentation(notFound)).toMatchObject({
      isNotFound: true,
      requestId: "req-404",
      title: "Not found",
    });
    expect(isApiNotFoundError(notFound)).toBe(true);
    expect(getApiErrorPresentation(new APIClientError("Duplicate", 409, "conflict")).title)
      .toBe("Could not save changes");
    expect(getApiErrorPresentation(new APIClientError("Bad filter", 400, "invalid_request")).title)
      .toBe("Invalid request");
    expect(getApiErrorPresentation(new APIClientError("Invalid", 200, "invalid_response")).title)
      .toBe("Invalid server response");
    expect(getApiErrorPresentation(new TypeError("fetch failed")).title).toBe("Connection failed");
    const localValidationError = z.object({ id: z.number() }).safeParse({ id: "bad" });
    expect(localValidationError.success).toBe(false);
    if (!localValidationError.success) {
      expect(getApiErrorPresentation(localValidationError.error)).toEqual({
        description: "One or more request values are invalid.",
        isNotFound: false,
        title: "Invalid request",
      });
    }
  });

  it("shows the safe request reference without exposing structured details", () => {
    const error = new APIClientError(
      "Unable to update job",
      500,
      "internal_error",
      { secret: "must-not-render" },
      "req-safe"
    );

    const message = getApiErrorMessage(error, "Fallback");
    expect(message).toBe("Unable to update job (Request ID: req-safe)");
    expect(message).not.toContain("must-not-render");
  });
});
