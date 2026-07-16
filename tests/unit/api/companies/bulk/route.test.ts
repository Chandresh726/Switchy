import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  deleteCompanies: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: mocks.update,
  },
}));

vi.mock("@/lib/scraper/maintenance", () => ({
  getLocalDataMaintenanceService: () => ({
    deleteCompanies: mocks.deleteCompanies,
  }),
}));

import { DELETE, PATCH } from "@/app/api/companies/bulk/route";

function createJsonRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/companies/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("companies bulk route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteCompanies.mockReturnValue({
      deletedCompanies: 0,
      deletedJobs: 0,
    });
  });

  it("rejects bulk delete without company IDs", async () => {
    const response = await DELETE(createJsonRequest({ companyIds: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid request payload",
      code: "invalid_request",
      requestId: expect.any(String),
    });
    expect(mocks.deleteCompanies).not.toHaveBeenCalled();
  });

  it("deletes jobs before companies and reports counts", async () => {
    mocks.deleteCompanies.mockReturnValue({
      deletedCompanies: 1,
      deletedJobs: 2,
    });

    const response = await DELETE(createJsonRequest({ companyIds: [1] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      deletedCompanies: 1,
      deletedJobs: 2,
    });
    expect(mocks.deleteCompanies).toHaveBeenCalledWith([1]);
  });

  it("rejects bulk active toggle without a boolean isActive", async () => {
    const response = await PATCH(createJsonRequest({ companyIds: [1], isActive: "false" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid request payload",
      code: "invalid_request",
      requestId: expect.any(String),
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
