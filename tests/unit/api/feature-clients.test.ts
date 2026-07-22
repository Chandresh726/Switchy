import { afterEach, describe, expect, it, vi } from "vitest";

import { openAIContentStream } from "@/lib/api/clients/ai";
import { bulkSetCompaniesActive, syncCompanies } from "@/lib/api/clients/companies";
import { getReadiness, getRuntimeHealth } from "@/lib/api/clients/health";
import { cancelMatchHistorySession } from "@/lib/api/clients/history";
import { clearJobs, getJob, getJobs, updateJob } from "@/lib/api/clients/jobs";
import {
  archivePerson,
  clearPeople,
  deleteCompanyAlias,
  getCompanyAliases,
  getPeople,
  getPeopleDuplicates,
  getPeopleImportSession,
  getPersonDetail,
  importPeople,
  mergePeople,
  purgePerson,
  remapCompanyAlias,
  restorePerson,
  splitPersonSource,
} from "@/lib/api/clients/people";
import { createSkill, deleteResume } from "@/lib/api/clients/profile";
import { deleteProvider, getProviderModels } from "@/lib/api/clients/providers";
import { getMatchSession, recoverScheduler } from "@/lib/api/clients/runtime";
import { patchSettings } from "@/lib/api/clients/settings";
import { getStats } from "@/lib/api/clients/stats";

const EMPTY_STATS_RESPONSE = {
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
  period: { days: 30, start: "2026-06-18T00:00:00.000Z", end: "2026-07-18T00:00:00.000Z" },
  activeJobs: 0,
  activeHighMatchJobs: 0,
  statusCounts: { new: 0, viewed: 0, interested: 0, applied: 0, rejected: 0, archived: 0 },
  recentActivity: { discovered: 0, viewed: 0, applied: 0 },
} as const;

const PERSON_DETAIL_RESPONSE = {
  id: 1,
  source: "linkedin",
  sourceRecordKey: "ada",
  identityKey: "linkedin:ada",
  fullName: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  profileUrl: "https://linkedin.com/in/ada",
  profileUrlNormalized: "https://linkedin.com/in/ada",
  email: "ada@example.com",
  companyRaw: "Acme",
  companyNormalized: "acme",
  position: "Engineer",
  mappedCompanyId: null,
  isStarred: false,
  isActive: true,
  lastSeenAt: "2026-07-20T00:00:00.000Z",
  connectedOn: null,
  roleTag: null,
  roleTagSource: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  isRecruiter: false,
  company: null,
  sources: [{
    id: 1,
    personId: 1,
    source: "linkedin",
    sourceRecordKey: "ada",
    stableIdentityKey: "linkedin:https://linkedin.com/in/ada",
    identityKind: "linkedin_url",
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    profileUrl: "https://linkedin.com/in/ada",
    profileUrlNormalized: "https://linkedin.com/in/ada",
    email: "ada@example.com",
    emailNormalized: "ada@example.com",
    companyRaw: "Acme",
    companyNormalized: "acme",
    position: "Engineer",
    connectedOn: null,
    sourceNotes: null,
    isActive: true,
    firstSeenAt: "2026-07-20T00:00:00.000Z",
    lastSeenAt: "2026-07-20T00:00:00.000Z",
    lastImportSessionId: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  }],
} as const;

const IMPORT_SESSION_DETAIL_RESPONSE = {
  id: "session/id",
  source: "linkedin",
  fileName: "connections.csv",
  importMode: "merge",
  totalRows: 1,
  insertedRows: 1,
  updatedRows: 0,
  unchangedRows: 0,
  reactivatedRows: 0,
  duplicateRows: 0,
  deactivatedRows: 0,
  invalidRows: 0,
  unmatchedCompanyRows: 0,
  startedAt: "2026-07-20T00:00:00.000Z",
  completedAt: "2026-07-20T00:00:01.000Z",
  status: "completed",
  errorMessage: null,
  issues: [],
  issuePagination: { total: 0, limit: 5, offset: 0, hasMore: false },
} as const;

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

  it("serializes job activity dates and date sorting through the jobs contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ jobs: [], totalCount: 0, hasMore: false })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getJobs({
      appliedSince: new Date("2026-07-18T00:00:00.000Z"),
      sortBy: "appliedAt",
      sortOrder: "asc",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/jobs?appliedSince=2026-07-18T00%3A00%3A00.000Z&sortBy=appliedAt&sortOrder=asc&offset=0&limit=25"
    );
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

  it("covers backend-only people lifecycle, provenance, duplicate, and alias clients", async () => {
    const alias = {
      id: 3,
      companyNormalized: "acme",
      mappedCompanyId: 7,
      mappedCompany: { id: 7, name: "Acme" },
      affectedPeopleCount: 1,
      createdAt: "2026-07-20T00:00:00.000Z",
    };
    const splitPerson = {
      ...PERSON_DETAIL_RESPONSE,
      id: 2,
      identityKey: "linkedin:split",
      sourceRecordKey: "split",
      sources: [{ ...PERSON_DETAIL_RESPONSE.sources[0], id: 2, personId: 2, sourceRecordKey: "split" }],
    };
    const responses = [
      PERSON_DETAIL_RESPONSE,
      PERSON_DETAIL_RESPONSE,
      PERSON_DETAIL_RESPONSE,
      { deletedId: 1 },
      { groups: [], totalCount: 0, hasMore: false },
      { person: PERSON_DETAIL_RESPONSE, mergedPersonId: 2 },
      { person: PERSON_DETAIL_RESPONSE, createdPerson: splitPerson },
      IMPORT_SESSION_DETAIL_RESPONSE,
      { aliases: [alias], totalCount: 1, hasMore: false },
      { alias, updatedPeopleCount: 1 },
      { alias: null, updatedPeopleCount: 1 },
    ];
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    await getPersonDetail(1);
    await archivePerson(1);
    await restorePerson(1);
    await purgePerson(1);
    await getPeopleDuplicates({ limit: 5, offset: 10 });
    await mergePeople(1, { duplicatePersonId: 2 });
    await splitPersonSource(1, 2);
    await getPeopleImportSession("session/id", { issueLimit: 5 });
    await getCompanyAliases({ limit: 10 });
    await remapCompanyAlias(3, { mappedCompanyId: 7, updateExistingPeople: true });
    await deleteCompanyAlias(3, "unmap");

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/people/1",
      "/api/people/1",
      "/api/people/1/restore",
      "/api/people/1/purge",
      "/api/people/duplicates?limit=5&offset=10",
      "/api/people/1/merge",
      "/api/people/1/sources/2/split",
      "/api/people/import-sessions/session%2Fid?issueLimit=5&issueOffset=0",
      "/api/people/company-aliases?limit=10&offset=0",
      "/api/people/company-aliases/3",
      "/api/people/company-aliases/3?existingPeople=unmap",
    ]);
    expect(fetchMock.mock.calls.slice(1, 4).map(([, init]) => init.method)).toEqual([
      "DELETE",
      "POST",
      "DELETE",
    ]);
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "x-switchy-request": "true" }),
      body: JSON.stringify({ duplicatePersonId: 2 }),
    });
    expect(fetchMock.mock.calls[9]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ mappedCompanyId: 7, updateExistingPeople: true }),
    });
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(EMPTY_STATS_RESPONSE)));

    await expect(getStats(30)).resolves.toMatchObject({ totalJobs: 0, period: { days: 30 } });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/stats?days=30");
  });

  it("rejects malformed stats period timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ...EMPTY_STATS_RESPONSE,
      period: { ...EMPTY_STATS_RESPONSE.period, start: "not-an-iso-timestamp" },
    })));

    await expect(getStats(30)).rejects.toMatchObject({ code: "invalid_response" });
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
