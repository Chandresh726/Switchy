import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  importCompanies: vi.fn(),
  syncCompanies: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  updateSkill: vi.fn(),
  deleteExperience: vi.fn(),
  updateSettings: vi.fn(),
  deleteMatchHistorySession: vi.fn(),
  cancelScrapeHistorySession: vi.fn(),
  clearJobs: vi.fn(),
  deleteCompany: vi.fn(),
}));

vi.mock("@/lib/application/companies-service", () => ({
  getCompany: vi.fn(),
  replaceCompany: vi.fn(),
  patchCompany: vi.fn(),
  deleteCompany: services.deleteCompany,
  importCompanies: services.importCompanies,
  syncCompanies: services.syncCompanies,
}));
vi.mock("@/lib/application/jobs-service", () => ({
  getJob: vi.fn(),
  updateJob: services.updateJob,
  deleteJob: services.deleteJob,
}));
vi.mock("@/lib/application/profile-service", () => ({
  updateSkill: services.updateSkill,
  deleteSkill: vi.fn(),
  updateExperience: vi.fn(),
  deleteExperience: services.deleteExperience,
}));
vi.mock("@/lib/application/settings-service", () => ({ getSettings: vi.fn(), updateSettings: services.updateSettings }));
vi.mock("@/lib/application/history-service", () => ({
  getMatchHistoryDetail: vi.fn(),
  deleteMatchHistorySession: services.deleteMatchHistorySession,
  cancelScrapeHistorySession: services.cancelScrapeHistorySession,
}));
vi.mock("@/lib/application/maintenance-service", () => ({ clearJobs: services.clearJobs }));

import { POST as importCompanies } from "@/app/api/companies/import/route";
import { PUT as syncCompanies } from "@/app/api/companies/sync/route";
import { DELETE as deleteCompany } from "@/app/api/companies/[id]/route";
import { DELETE as deleteJob, PATCH as updateJob } from "@/app/api/jobs/[id]/route";
import { POST as clearJobs } from "@/app/api/maintenance/jobs/clear/route";
import { DELETE as deleteMatchHistory } from "@/app/api/match-history/[id]/route";
import { DELETE as deleteExperience } from "@/app/api/profile/experience/[id]/route";
import { PATCH as updateSkill } from "@/app/api/profile/skills/[id]/route";
import { POST as cancelScrapeHistory } from "@/app/api/scrape-history/[id]/cancel/route";
import { PATCH as updateSettings } from "@/app/api/settings/route";

function mutationRequest(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      origin: "http://localhost",
      "x-switchy-request": "true",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("explicit resource route delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.importCompanies.mockResolvedValue({ id: 1 });
    services.syncCompanies.mockResolvedValue({ success: true });
    services.updateJob.mockResolvedValue({ id: 4, status: "viewed" });
    services.deleteJob.mockResolvedValue({ success: true });
    services.updateSkill.mockResolvedValue({ id: 5, name: "TypeScript", category: "Language" });
    services.deleteExperience.mockResolvedValue({ success: true });
    services.updateSettings.mockResolvedValue({ scheduler_enabled: "false" });
    services.deleteMatchHistorySession.mockResolvedValue({ success: true });
    services.cancelScrapeHistorySession.mockResolvedValue({ success: true, stopped: true });
    services.clearJobs.mockResolvedValue({ success: true, deletedCount: 3 });
    services.deleteCompany.mockResolvedValue({ success: true });
  });

  it("delegates validated company import and synchronization payloads", async () => {
    await importCompanies(mutationRequest("/api/companies/import", "POST", { name: "Acme", careersUrl: "https://example.com/careers" }));
    await syncCompanies(mutationRequest("/api/companies/sync", "PUT", [{ name: "Acme", careersUrl: "https://example.com/careers" }]));
    expect(services.importCompanies).toHaveBeenCalledWith(expect.objectContaining({ name: "Acme" }), expect.objectContaining({ requestId: expect.any(String) }));
    expect(services.syncCompanies).toHaveBeenCalledWith([expect.objectContaining({ name: "Acme" })], expect.objectContaining({ requestId: expect.any(String) }));
  });

  it("preserves the company resource invalid-ID error contract", async () => {
    const response = await deleteCompany(mutationRequest("/api/companies/not-an-id", "DELETE"), { params: Promise.resolve({ id: "not-an-id" }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid company id", code: "invalid_company_id" });
    expect(services.deleteCompany).not.toHaveBeenCalled();
  });

  it("delegates IDs from resource paths instead of mutation bodies", async () => {
    await updateJob(mutationRequest("/api/jobs/4", "PATCH", { status: "viewed" }), { params: Promise.resolve({ id: "4" }) });
    await deleteJob(mutationRequest("/api/jobs/4", "DELETE"), { params: Promise.resolve({ id: "4" }) });
    await updateSkill(mutationRequest("/api/profile/skills/5", "PATCH", { category: "Language" }), { params: Promise.resolve({ id: "5" }) });
    await deleteExperience(mutationRequest("/api/profile/experience/6", "DELETE"), { params: Promise.resolve({ id: "6" }) });
    expect(services.updateJob).toHaveBeenCalledWith(4, { status: "viewed" });
    expect(services.deleteJob).toHaveBeenCalledWith(4);
    expect(services.updateSkill).toHaveBeenCalledWith(5, { category: "Language" });
    expect(services.deleteExperience).toHaveBeenCalledWith(6);
  });

  it("delegates explicit history commands and maintenance commands", async () => {
    await deleteMatchHistory(mutationRequest("/api/match-history/run-1", "DELETE"), { params: Promise.resolve({ id: "run-1" }) });
    await cancelScrapeHistory(mutationRequest("/api/scrape-history/run-2/cancel", "POST"), { params: Promise.resolve({ id: "run-2" }) });
    await clearJobs(mutationRequest("/api/maintenance/jobs/clear", "POST"));
    expect(services.deleteMatchHistorySession).toHaveBeenCalledWith("run-1");
    expect(services.cancelScrapeHistorySession).toHaveBeenCalledWith("run-2");
    expect(services.clearJobs).toHaveBeenCalledTimes(1);
  });

  it("delegates the settings PATCH contract", async () => {
    const response = await updateSettings(mutationRequest("/api/settings", "PATCH", { scheduler_enabled: false }));
    expect(response.status).toBe(200);
    expect(services.updateSettings).toHaveBeenCalledWith(
      { scheduler_enabled: false },
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });
});
