import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AIError } from "@/lib/ai/shared/errors";
import {
  ConflictError,
  handleApiError,
  NotFoundError,
} from "@/lib/api/error-handler";

const request = new Request("http://localhost/api/test", {
  headers: { "x-request-id": "request-123" },
});

async function expectEnvelope(
  response: Response,
  expected: { status: number; code: string }
): Promise<void> {
  const body = await response.json();
  expect(response.status).toBe(expected.status);
  expect(body).toMatchObject({
    code: expected.code,
    requestId: "request-123",
  });
  expect(response.headers.get("x-request-id")).toBe("request-123");
}

describe("unified API error handler", () => {
  it("maps malformed JSON and Zod errors to stable 400 envelopes", async () => {
    await expectEnvelope(handleApiError(new SyntaxError("bad json"), { request }), {
      status: 400,
      code: "invalid_json",
    });

    const result = z.object({ limit: z.number() }).safeParse({ limit: "bad" });
    expect(result.success).toBe(false);
    await expectEnvelope(handleApiError(result.error, { request }), {
      status: 400,
      code: "invalid_request",
    });
  });

  it("maps not-found and conflict errors", async () => {
    await expectEnvelope(
      handleApiError(new NotFoundError("Missing"), { request }),
      { status: 404, code: "not_found" }
    );
    await expectEnvelope(
      handleApiError(new ConflictError("Duplicate"), { request }),
      { status: 409, code: "conflict" }
    );
  });

  it("does not leak unexpected error details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleApiError(new Error("SENTINEL_PRIVATE_DETAIL"), {
      request,
    });
    const body = await response.json();

    expect(body).toMatchObject({
      error: "An unexpected error occurred",
      code: "internal_error",
      requestId: "request-123",
    });
    expect(JSON.stringify(body)).not.toContain("SENTINEL_PRIVATE_DETAIL");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "SENTINEL_PRIVATE_DETAIL"
    );
    consoleError.mockRestore();
  });

  it("emits sanitized correlated logs for every mapped error category", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const zodResult = z.object({ id: z.number() }).safeParse({ id: "bad" });
    expect(zodResult.success).toBe(false);
    const conflict = Object.assign(new Error("SENTINEL_DATABASE_DETAIL"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });

    handleApiError(new NotFoundError("Missing"), { request });
    handleApiError(new SyntaxError("SENTINEL_JSON_DETAIL"), { request });
    handleApiError(zodResult.error, { request });
    handleApiError(new AIError({
      type: "missing_api_key",
      message: "SENTINEL_AI_DETAIL",
      retryable: false,
    }), { request });
    handleApiError(conflict, { request });

    const records = consoleError.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(records).toHaveLength(5);
    expect(records.map(({ code }) => code)).toEqual([
      "not_found",
      "invalid_json",
      "invalid_request",
      "missing_api_key",
      "conflict",
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        event: "api_error",
        requestId: "request-123",
        code: expect.any(String),
        status: expect.any(Number),
        errorType: expect.any(String),
      });
    }
    expect(JSON.stringify(records)).not.toContain("SENTINEL");
    consoleError.mockRestore();
  });
});
