import { afterEach, describe, expect, it, vi } from "vitest";

import { openAIContentStream } from "@/lib/api/clients/ai";
import { bulkSetCompaniesActive, syncCompanies } from "@/lib/api/clients/companies";
import { getReadiness, getRuntimeHealth } from "@/lib/api/clients/health";
import { cancelMatchHistorySession } from "@/lib/api/clients/history";
import { clearJobs, getJob, getJobs, updateJob } from "@/lib/api/clients/jobs";
import { clearPeople, getPeople, importPeople } from "@/lib/api/clients/people";
import { createSkill, deleteResume } from "@/lib/api/clients/profile";
import { deleteProvider, getProviderModels } from "@/lib/api/clients/providers";
import { getMatchSession, recoverScheduler } from "@/lib/api/clients/runtime";
import { patchSettings } from "@/lib/api/clients/settings";
import { getStats } from "@/lib/api/clients/stats";

describe("typed feature clients", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes canonical job parameters and validates mutation bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ jobs: [], totalCount: 0, hasMore: false }))
      .mockResolvedValueOnce(
        Response.json({
          id: 7,
          status: "applied",
          viewedAt: null,
          appliedAt: null,
          archivedAt: null,
          archiveSource: null,
          updatedAt: null,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getJobs({ companyIds: [4, 2], status: "new", limit: 10 });
    await updateJob(7, { status: "applied" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/jobs?companyIds=4%2C2&status=new&sortBy=matchScore&sortOrder=desc&offset=0&limit=10"
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/jobs/7",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "x-switchy-request": "true" }),
        body: JSON.stringify({ status: "applied" }),
      }),
    ]);
  });

  it("rejects invalid resource IDs before making a request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => getJob(0)).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes people and provider queries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ people: [], totalCount: 0, hasMore: false })
      )
      .mockResolvedValueOnce(
        Response.json({
          providerId: "provider/id",
          provider: "openai",
          models: [],
          fetchedAt: "2026-07-17T00:00:00.000Z",
          isStale: false,
          source: "live",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await getPeople({ active: "all", source: "manual", limit: 5 });
    await getProviderModels("provider/id", { refresh: "true" });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("source=manual");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/providers/provider%2Fid/models?refresh=true"
    );
  });

  it("omits an empty provider-model query delimiter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        providerId: "provider-1",
        provider: "openai",
        models: [],
        fetchedAt: "2026-07-17T00:00:00.000Z",
        isStale: false,
        source: "live",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getProviderModels("provider-1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/providers/provider-1/models");
  });

  it("covers company, maintenance, profile, history, runtime, and provider commands", async () => {
    const responses = [
      { success: true, updated: 2, message: "Updated" },
      { success: true },
      { deletedCount: 4 },
      { success: true },
      { success: true },
      { status: "not_needed", pendingMissedCount: 0, oldestMissedRun: null, latestMissedRun: null },
      { success: true },
    ];
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    await bulkSetCompaniesActive([2, 3], false);
    await clearJobs();
    await clearPeople();
    await deleteResume(9);
    await cancelMatchHistorySession("match/session");
    await recoverScheduler();
    await deleteProvider("provider/id");

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/companies/bulk",
      "/api/maintenance/jobs/clear",
      "/api/maintenance/people/clear",
      "/api/profile/resumes/9",
      "/api/match-history/match%2Fsession/cancel",
      "/api/scheduler/recover",
      "/api/providers/provider%2Fid",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers).toMatchObject({ "x-switchy-request": "true" });
    }
  });

  it("validates inputs for company, people import, profile, settings, and runtime before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncCompanies([{ name: "Bad", careersUrl: "not-a-url" }])).rejects.toThrow();
    expect(() => importPeople(new FormData())).toThrow();
    await expect(createSkill({ profileId: 0, name: "TypeScript" })).rejects.toThrow();
    await expect(patchSettings({ unknown_setting: "x" } as never)).rejects.toThrow();
    expect(() => getMatchSession(" ")).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps AI streaming as a validated marked request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("stream"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await openAIContentStream(
      { jobId: 8, type: "cover_letter", userPrompt: null, parentVariantId: null },
      controller.signal
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/content/stream",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        headers: expect.objectContaining({ "x-switchy-request": "true" }),
      })
    );
  });

  it("validates the stats client response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      totalJobs: 0,
      totalCompanies: 0,
      highMatchJobs: 0,
      appliedJobs: 0,
      newJobs: 0,
      viewedJobs: 0,
      savedJobs: 0,
      jobsWithScore: 0,
      lastScan: null,
      totalPeople: 0,
      starredPeople: 0,
      mappedPeople: 0,
      unmatchedCompanyCount: 0,
      unmatchedPeopleCount: 0,
    })));

    await expect(getStats()).resolves.toMatchObject({ totalJobs: 0 });
  });

  it("validates readiness and runtime-health responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ready: true,
          databaseAvailable: true,
          schedulerInitialization: "ready",
          queueRecovery: "ready",
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          databaseAvailable: true,
          schedulerInitialization: "ready",
          queueRecovery: "ready",
          lastSuccessfulRecoveryAt: null,
          lastSuccessfulDispatchAt: null,
          oldestQueuedWorkAgeMs: null,
          expiredLeaseCount: 0,
          lastError: null,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getReadiness()).resolves.toMatchObject({ ready: true });
    await expect(getRuntimeHealth()).resolves.toMatchObject({ expiredLeaseCount: 0 });
  });

  it("returns a valid readiness contract from the intentional 503 state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ready: false,
      databaseAvailable: false,
      schedulerInitialization: "failed",
      queueRecovery: "pending",
    }, { status: 503 })));

    await expect(getReadiness()).resolves.toEqual({
      ready: false,
      databaseAvailable: false,
      schedulerInitialization: "failed",
      queueRecovery: "pending",
    });
  });

  it("still parses a genuine error envelope returned with readiness 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: "Readiness probe failed",
      code: "readiness_failed",
      requestId: "req-ready",
    }, { status: 503 })));

    await expect(getReadiness()).rejects.toMatchObject({
      status: 503,
      code: "readiness_failed",
      requestId: "req-ready",
    });
  });
});
