import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  apiCommand,
  apiFileRequest,
  apiGet,
  apiJsonMutation,
  serializeQuery,
} from "@/lib/api/client";
import { APIClientError } from "@/lib/api/errors";

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

  it("validates and canonically serializes query parameters", () => {
    const schema = z.object({
      ids: z.array(z.coerce.number().int().positive()).optional(),
      limit: z.coerce.number().int().positive().max(100).default(25),
      search: z.string().trim().min(1).optional(),
    });

    expect(serializeQuery(schema, { ids: [3, 1], search: " jobs " })).toBe(
      "ids=3%2C1&limit=25&search=jobs"
    );
    expect(() => serializeQuery(schema, { limit: 101 })).toThrow();
  });

  it("rejects invalid mutation input before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiJsonMutation(
        "/api/test",
        "POST",
        z.object({ count: z.number().int().positive() }),
        { count: 0 },
        z.object({ success: z.boolean() }),
        "Failed"
      )
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds the local mutation marker to JSON and bodyless commands", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiJsonMutation(
      "/api/test",
      "PATCH",
      z.object({ name: z.string().trim() }),
      { name: " Switchy " },
      z.object({ success: z.boolean() }),
      "Failed"
    );
    await apiCommand(
      "/api/test/clear",
      "POST",
      z.object({ success: z.boolean() }),
      "Failed"
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/test",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "x-switchy-request": "true" }),
        body: JSON.stringify({ name: "Switchy" }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/test/clear",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-switchy-request": "true" }),
      })
    );
  });

  it("returns file bodies with a safe server filename", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("resume", {
          headers: { "content-disposition": "attachment; filename=\"../resume.pdf\"" },
        })
      )
    );

    const result = await apiFileRequest("/api/resume", { method: "GET" }, "Failed");
    expect(result.fileName).toBe("resume.pdf");
    await expect(result.blob.text()).resolves.toBe("resume");
  });

  it("parses structured file-download failures instead of returning a blob", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "Resume missing", code: "not_found", requestId: "req-file" },
          { status: 404 }
        )
      )
    );

    await expect(
      apiFileRequest("/api/resume", { method: "GET" }, "Failed")
    ).rejects.toMatchObject({
      message: "Resume missing",
      status: 404,
      code: "not_found",
      requestId: "req-file",
    });
  });
});
