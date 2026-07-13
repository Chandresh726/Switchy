import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  deleteCompanies: vi.fn(),
  deleteCompanyJobs: vi.fn(),
  deleteMatchData: vi.fn(),
  deleteMatchHistory: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/people/sync", () => ({
  refreshUnmatchedCompanyMappings: vi.fn(),
}));

vi.mock("@/lib/scraper/maintenance", () => ({
  getLocalDataMaintenanceService: () => ({
    deleteCompanies: mocks.deleteCompanies,
    deleteCompanyJobs: mocks.deleteCompanyJobs,
    deleteMatchData: mocks.deleteMatchData,
    deleteMatchHistory: mocks.deleteMatchHistory,
  }),
}));

vi.mock("@/lib/scraper/matching", () => ({
  stopMatchSession: vi.fn(),
}));

import { DELETE as deleteCompany } from "@/app/api/companies/[id]/route";
import { DELETE as deleteCompanyJobs } from "@/app/api/companies/[id]/jobs/route";
import { DELETE as deleteBulkCompanyJobs } from "@/app/api/companies/bulk/jobs/route";
import { DELETE as deleteMatchData } from "@/app/api/jobs/match-data/route";
import { DELETE as deleteMatchHistory } from "@/app/api/match-history/route";

function request(url: string, body?: Record<string, unknown>): NextRequest {
  return new Request(url, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest;
}

describe("maintenance API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteCompanies.mockReturnValue({
      deletedCompanies: 1,
      deletedJobs: 2,
    });
    mocks.deleteCompanyJobs.mockReturnValue(3);
    mocks.deleteMatchData.mockReturnValue(7);
    mocks.deleteMatchHistory.mockReturnValue(1);
  });

  it("routes a single company deletion through local maintenance", async () => {
    const response = await deleteCompany(
      request("http://localhost/api/companies/42"),
      { params: Promise.resolve({ id: "42" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.deleteCompanies).toHaveBeenCalledWith([42]);
  });

  it("preserves single and bulk company-job deletion responses", async () => {
    const singleResponse = await deleteCompanyJobs(
      request("http://localhost/api/companies/42/jobs"),
      { params: Promise.resolve({ id: "42" }) }
    );
    const bulkResponse = await deleteBulkCompanyJobs(
      request("http://localhost/api/companies/bulk/jobs", {
        companyIds: [42, 43],
      })
    );

    expect(await singleResponse.json()).toEqual({
      success: true,
      deletedCount: 3,
      message: "Deleted 3 job(s) for company 42",
    });
    expect(await bulkResponse.json()).toEqual({
      success: true,
      deletedCount: 3,
      message: "Deleted 3 jobs from 2 companies",
    });
    expect(mocks.deleteCompanyJobs).toHaveBeenNthCalledWith(1, [42]);
    expect(mocks.deleteCompanyJobs).toHaveBeenNthCalledWith(2, [42, 43]);
  });

  it("clears all match data while preserving the response contract", async () => {
    const response = await deleteMatchData(
      request("http://localhost/api/jobs/match-data")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      jobsCleared: 7,
      message: "Cleared match data from 7 jobs",
    });
    expect(mocks.deleteMatchData).toHaveBeenCalledTimes(1);
  });

  it("clears one or all match-history sessions through local maintenance", async () => {
    const one = await deleteMatchHistory(
      request("http://localhost/api/match-history?sessionId=match-1")
    );
    const all = await deleteMatchHistory(
      request("http://localhost/api/match-history")
    );

    expect(one.status).toBe(200);
    expect(all.status).toBe(200);
    expect(mocks.deleteMatchHistory).toHaveBeenNthCalledWith(1, "match-1");
    expect(mocks.deleteMatchHistory).toHaveBeenNthCalledWith(2, undefined);
  });
});
