import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  deleteCompanies: vi.fn(),
  deleteCompanyJobs: vi.fn(),
  deleteMatchData: vi.fn(),
  deleteMatchHistory: vi.fn(),
  findCompany: vi.fn(),
  stopMatchSession: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          const company = await mocks.findCompany();
          return company ? [company] : [];
        },
      }),
    }),
    query: {
      companies: { findFirst: mocks.findCompany },
    },
  },
}));

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

vi.mock("@/lib/scraper/matching/lifecycle", () => ({
  stopMatchSession: mocks.stopMatchSession,
}));

import { DELETE as deleteCompany } from "@/app/api/companies/[id]/route";
import { DELETE as deleteCompanyJobs } from "@/app/api/companies/[id]/jobs/route";
import { DELETE as deleteBulkCompanyJobs } from "@/app/api/companies/bulk/jobs/route";
import { DELETE as deleteMatchData } from "@/app/api/jobs/match-data/route";
import { DELETE as deleteMatchHistory } from "@/app/api/match-history/[id]/route";
import { POST as cancelMatchHistory } from "@/app/api/match-history/[id]/cancel/route";
import { POST as clearMatchHistory } from "@/app/api/maintenance/match-history/clear/route";

function request(url: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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
    mocks.findCompany.mockResolvedValue({ id: 42 });
    mocks.stopMatchSession.mockResolvedValue({ stopped: true, exists: true, status: "cancelled" });
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

  it("returns 404 when a targeted company deletion removes nothing", async () => {
    mocks.deleteCompanies.mockResolvedValueOnce({
      deletedCompanies: 0,
      deletedJobs: 0,
    });

    const response = await deleteCompany(
      request("http://localhost/api/companies/404"),
      { params: Promise.resolve({ id: "404" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "company_not_found",
      requestId: expect.any(String),
    });
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

  it("returns 404 without deleting jobs for a missing company", async () => {
    mocks.findCompany.mockResolvedValueOnce(undefined);

    const response = await deleteCompanyJobs(
      request("http://localhost/api/companies/404/jobs"),
      { params: Promise.resolve({ id: "404" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "company_not_found",
      requestId: expect.any(String),
    });
    expect(mocks.deleteCompanyJobs).not.toHaveBeenCalled();
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

  it("deletes one or clears all match-history sessions through explicit commands", async () => {
    const one = await deleteMatchHistory(
      request("http://localhost/api/match-history/match-1"),
      { params: Promise.resolve({ id: "match-1" }) }
    );
    const all = await clearMatchHistory(new NextRequest("http://localhost/api/maintenance/match-history/clear", { method: "POST" }));

    expect(one.status).toBe(200);
    expect(all.status).toBe(200);
    expect(mocks.deleteMatchHistory).toHaveBeenNthCalledWith(1, "match-1");
    expect(mocks.deleteMatchHistory).toHaveBeenNthCalledWith(2);
  });

  it("returns 404 for a missing targeted match-history session while clear remains idempotent", async () => {
    mocks.deleteMatchHistory.mockResolvedValue(0);

    const targeted = await deleteMatchHistory(
      request("http://localhost/api/match-history/missing"),
      { params: Promise.resolve({ id: "missing" }) }
    );
    const collection = await clearMatchHistory(new NextRequest("http://localhost/api/maintenance/match-history/clear", { method: "POST" }));

    expect(targeted.status).toBe(404);
    await expect(targeted.json()).resolves.toMatchObject({
      code: "match_session_not_found",
      requestId: expect.any(String),
    });
    expect(collection.status).toBe(200);
  });

  it("preserves match-history cancellation outcomes", async () => {
    const stopped = await cancelMatchHistory(
      new NextRequest("http://localhost/api/match-history/match-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ id: "match-1" }) }
    );
    expect(await stopped.json()).toEqual({ success: true, stopped: true });

    mocks.stopMatchSession.mockResolvedValueOnce({ stopped: false, exists: true, status: "completed" });
    const terminal = await cancelMatchHistory(
      new NextRequest("http://localhost/api/match-history/match-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ id: "match-1" }) }
    );
    expect(await terminal.json()).toEqual({ success: true, stopped: false, status: "completed" });

    mocks.stopMatchSession.mockResolvedValueOnce({ stopped: false, exists: false, status: null });
    const missing = await cancelMatchHistory(
      new NextRequest("http://localhost/api/match-history/missing/cancel", { method: "POST" }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(missing.status).toBe(404);
  });
});
