import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  deleteAllJobs: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/db", () => ({
  db: {
    delete: mocks.delete,
    update: mocks.update,
  },
}));

vi.mock("@/lib/scraper/maintenance", () => ({
  getLocalDataMaintenanceService: () => ({
    deleteAllJobs: mocks.deleteAllJobs,
  }),
}));

import { PATCH } from "@/app/api/jobs/[id]/route";
import { POST as clearJobs } from "@/app/api/maintenance/jobs/clear/route";

describe("jobs route mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives a job with manual archive metadata", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 42, status: "archived" }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn((data: Record<string, unknown>) => {
      void data;
      return { where };
    });
    mocks.update.mockReturnValue({ set });

    const request = new Request("http://localhost/api/jobs/42", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    const response = await PATCH(request as NextRequest, { params: Promise.resolve({ id: "42" }) });
    const body = await response.json();
    expect(set).toHaveBeenCalledTimes(1);
    const updateData = set.mock.calls[0][0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: 42, status: "archived" });
    expect(updateData.status).toBe("archived");
    expect(updateData.archiveSource).toBe("manual");
    expect(updateData.archivedAt).toBeInstanceOf(Date);
    expect(updateData.updatedAt).toBeInstanceOf(Date);
  });

  it("auto-sets viewedAt when marking a job viewed", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 42, status: "viewed" }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn((data: Record<string, unknown>) => {
      void data;
      return { where };
    });
    mocks.update.mockReturnValue({ set });

    const request = new Request("http://localhost/api/jobs/42", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "viewed" }),
    });

    const response = await PATCH(request as NextRequest, { params: Promise.resolve({ id: "42" }) });
    expect(set).toHaveBeenCalledTimes(1);
    const updateData = set.mock.calls[0][0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(updateData.viewedAt).toBeInstanceOf(Date);
    expect(updateData.archivedAt).toBeNull();
    expect(updateData.archiveSource).toBeNull();
  });

  it("deletes all jobs", async () => {
    const request = new Request("http://localhost/api/maintenance/jobs/clear", {
      method: "POST",
    });

    const response = await clearJobs(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mocks.deleteAllJobs).toHaveBeenCalledTimes(1);
  });
});
