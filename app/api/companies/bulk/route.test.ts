import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  delete: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/db", () => ({
  db: {
    delete: mocks.delete,
    select: mocks.select,
    transaction: mocks.transaction,
    update: mocks.update,
  },
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
    mocks.transaction.mockImplementation((operation) =>
      operation({ delete: mocks.delete, select: mocks.select })
    );
  });

  it("rejects bulk delete without company IDs", async () => {
    const response = await DELETE(createJsonRequest({ companyIds: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "companyIds must be a non-empty array" });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes jobs before companies and reports counts", async () => {
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({ all: () => [] }),
      }),
    });
    const jobsReturning = vi.fn(() => ({ all: () => [{ id: 10 }, { id: 11 }] }));
    const companiesReturning = vi.fn(() => ({ all: () => [{ id: 1 }] }));
    const jobsWhere = vi.fn(() => ({ returning: jobsReturning }));
    const companiesWhere = vi.fn(() => ({ returning: companiesReturning }));

    mocks.delete
      .mockReturnValueOnce({ where: jobsWhere })
      .mockReturnValueOnce({ where: companiesWhere });

    const response = await DELETE(createJsonRequest({ companyIds: [1] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      deletedCompanies: 1,
      deletedJobs: 2,
    });
    expect(mocks.delete).toHaveBeenCalledTimes(2);
  });

  it("rejects bulk active toggle without a boolean isActive", async () => {
    const response = await PATCH(createJsonRequest({ companyIds: [1], isActive: "false" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "isActive must be a boolean" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
