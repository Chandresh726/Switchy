import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  submitCompanies: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/scraper", () => ({
  getLocalScrapeQueueService: () => ({
    submitCompanies: mocks.submitCompanies,
  }),
}));

import { POST } from "@/app/api/companies/refresh-jobs/route";

function createRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/companies/refresh-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("manual company refresh route", () => {
  beforeEach(() => {
    mocks.submitCompanies.mockResolvedValue({ sessionId: "session-1", status: "queued", totalCompanies: 3 });
  });

  it.each([
    {},
    { companyIds: [] },
    { companyIds: [0] },
    { companyIds: ["not-a-number"] },
  ])("rejects invalid company selection %#", async (body) => {
    const response = await POST(createRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request payload",
      code: "invalid_request",
      requestId: expect.any(String),
    });
    expect(mocks.submitCompanies).not.toHaveBeenCalled();
  });

  it("maps an empty request body to the existing invalid JSON response", async () => {
    const request = new Request("http://localhost/api/companies/refresh-jobs", {
      method: "POST",
    }) as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid JSON in request body",
      code: "invalid_json",
    });
  });

  it("dispatches the durable queue with a manual trigger and acknowledges submission", async () => {
    const response = await POST(createRequest({ companyIds: [1, "2", 3] }));
    const body = await response.json();

    expect(mocks.assertAppRequest).toHaveBeenCalledTimes(1);
    expect(mocks.submitCompanies).toHaveBeenCalledWith([1, 2, 3], "manual");
    expect(response.status).toBe(202);
    expect(body).toEqual({ sessionId: "session-1", status: "queued", totalCompanies: 3 });
  });
});
