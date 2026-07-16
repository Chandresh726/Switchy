import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { apiGet, APIClientError } from "@/lib/api/client";

describe("validated API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a runtime-validated success payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ count: 3 }, { headers: { "x-request-id": "req-1" } })
      )
    );

    await expect(
      apiGet("/api/test", z.object({ count: z.number().int() }), "Failed")
    ).resolves.toEqual({ count: 3 });
  });

  it("rejects an invalid success payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { count: "three" },
          { headers: { "x-request-id": "req-invalid" } }
        )
      )
    );

    await expect(
      apiGet("/api/test", z.object({ count: z.number().int() }), "Failed")
    ).rejects.toMatchObject({
      code: "invalid_response",
      requestId: "req-invalid",
    });
  });

  it("parses the shared structured error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: "Invalid request payload",
            code: "invalid_request",
            details: [{ path: "limit" }],
            requestId: "req-error",
          },
          { status: 400, headers: { "x-request-id": "req-error" } }
        )
      )
    );

    const error = await apiGet(
      "/api/test",
      z.object({ count: z.number() }),
      "Fallback"
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(APIClientError);
    expect(error).toMatchObject({
      message: "Invalid request payload",
      status: 400,
      code: "invalid_request",
      requestId: "req-error",
    });
  });
});
