import { afterEach, describe, expect, it, vi } from "vitest";

import {
  companies,
  education,
  experience,
  jobs,
  people,
  profile,
  skills,
} from "@/lib/db/schema";
import {
  jobSchema,
  jobsQuerySchema,
  jobsResponseSchema,
  jobUpdateResponseSchema,
} from "@/lib/api/contracts/jobs";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-application-services-");

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/profile-rematch");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.doUnmock("@/lib/people/sync");
  vi.doUnmock("@/lib/scraper/maintenance");
  vi.resetModules();
});

describe("backend application services", () => {
  it("owns job status transitions and missing-resource behavior", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
      getMatchPresentations: vi.fn().mockImplementation(async (rows: Array<{ id: number; matchScore: number | null }>) =>
        new Map(rows.map((row) => [row.id, {
          matchScore: row.matchScore, matchReasons: [], matchedSkills: [], matchResultId: null,
          matchBreakdown: null, matchStale: false, matchLegacy: false,
          matchSummary: "", matchReasoning: [], matchRunId: null,
          matchPolicyVersion: null, scoringPolicyVersion: null,
        }]))
      ),
    }));
    const company = database.insert(companies).values({ name: "Acme", careersUrl: "https://example.com/jobs" }).returning().get();
    const job = database.insert(jobs).values({ companyId: company.id, title: "Engineer", url: "https://example.com/jobs/1" }).returning().get();
    const { deleteJob, getJob, updateJob } = await import("@/lib/application/jobs-service");

    const detail = await getJob(job.id);
    expect(jobSchema.parse(JSON.parse(JSON.stringify(detail)))).toMatchObject({
      id: job.id,
      matchReasons: [],
      matchedSkills: [],
    });
    expect(detail).not.toHaveProperty("aiFingerprint");
    expect(detail).not.toHaveProperty("missingSkills");
    expect(detail).not.toHaveProperty("recommendations");
    expect(detail).toHaveProperty("description");
    const archived = await updateJob(job.id, { status: "archived" });
    expect(jobUpdateResponseSchema.parse(JSON.parse(JSON.stringify(archived)))).toMatchObject({
      id: job.id,
      status: "archived",
      archiveSource: "manual",
    });
    expect(archived).toMatchObject({ status: "archived", archiveSource: "manual" });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(updateJob(999_999, { status: "viewed" })).rejects.toMatchObject({ code: "job_not_found" });
    await expect(deleteJob(job.id)).resolves.toEqual({ success: true });
    await expect(deleteJob(job.id)).rejects.toMatchObject({ code: "job_not_found" });
  });

  it("keeps 5,000-job list reads bounded, stable, and free of descriptions", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
      getMatchPresentations: vi.fn().mockImplementation(async (rows: Array<{ id: number; matchScore: number | null }>) =>
        new Map(rows.map((row) => [row.id, {
          matchScore: row.matchScore, matchReasons: [], matchedSkills: [], matchResultId: null,
          matchBreakdown: null, matchStale: false, matchLegacy: false,
          matchSummary: "", matchReasoning: [], matchRunId: null,
          matchPolicyVersion: null, scoringPolicyVersion: null,
        }]))
      ),
    }));
    const company = database.insert(companies).values({
      name: "Scale Co",
      careersUrl: "https://example.com/scale",
    }).returning().get();
    const discoveredAt = new Date("2026-07-16T00:00:00.000Z");
    database.transaction((tx) => {
      for (let index = 1; index <= 5_000; index += 1) {
        tx.insert(jobs).values({
          companyId: company.id,
          externalId: `scale-${index}`,
          title: "Backend Engineer",
          description: `private payload ${index}`,
          url: `https://example.com/scale/${index}`,
          discoveredAt,
        }).run();
      }
    });
    const { listJobs } = await import("@/lib/application/jobs-service");
    const firstPage = await listJobs(jobsQuerySchema.parse({
      sortBy: "discoveredAt",
      sortOrder: "desc",
      limit: 100,
      offset: 0,
    }));
    const secondPage = await listJobs(jobsQuerySchema.parse({
      sortBy: "discoveredAt",
      sortOrder: "desc",
      limit: 100,
      offset: 100,
    }));

    expect(firstPage).toMatchObject({ totalCount: 5_000, hasMore: true });
    expect(jobsResponseSchema.parse(JSON.parse(JSON.stringify(firstPage))).jobs).toHaveLength(100);
    expect(firstPage.jobs).toHaveLength(100);
    expect(secondPage.jobs).toHaveLength(100);
    expect(firstPage.jobs.every((job) => !("description" in job))).toBe(true);
    expect(firstPage.jobs.map((job) => job.id)).toEqual(
      [...firstPage.jobs.map((job) => job.id)].sort((left, right) => right - left)
    );
    expect(new Set([...firstPage.jobs, ...secondPage.jobs].map((job) => job.id)).size).toBe(200);
  });

  it("owns company import, read, update, and delete semantics", async () => {
    const { database } = harness.createDatabase();
    const deleteCompanies = vi.fn().mockResolvedValue({ deletedCompanies: 1, deletedJobs: 0 });
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/people/sync", () => ({ refreshUnmatchedCompanyMappings: vi.fn() }));
    vi.doMock("@/lib/scraper/maintenance", () => ({
      getLocalDataMaintenanceService: () => ({ deleteCompanies }),
    }));
    const service = await import("@/lib/application/companies-service");
    const context = { requestId: "company-test" };

    const created = await service.importCompanies({ name: "Acme", careersUrl: "https://example.com/careers", platform: undefined }, context);
    expect(Array.isArray(created)).toBe(false);
    if (Array.isArray(created)) throw new Error("Expected one company");
    await expect(service.getCompany(created.id)).resolves.toMatchObject({ name: "Acme" });
    await expect(service.patchCompany(created.id, { notes: "Priority" }, context)).resolves.toMatchObject({ notes: "Priority" });
    await expect(service.deleteCompany(created.id)).resolves.toEqual({ success: true });
    expect(deleteCompanies).toHaveBeenCalledWith([created.id]);
  });

  it("normalizes retried company imports and rejects duplicate syncs without partial writes", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/people/sync", () => ({ refreshUnmatchedCompanyMappings: vi.fn() }));
    const service = await import("@/lib/application/companies-service");
    const context = { requestId: "company-atomic-test" };
    const [first, retried] = await Promise.all([
      service.importCompanies({
        name: "Acme",
        careersUrl: "https://www.example.com/careers/",
        platform: undefined,
      }, context),
      service.importCompanies({
        name: "Acme updated",
        careersUrl: "https://example.com/careers",
        platform: undefined,
      }, context),
    ]);
    expect(Array.isArray(first) || Array.isArray(retried)).toBe(false);
    expect(database.select().from(companies).all()).toHaveLength(1);
    expect(database.select().from(companies).get()).toMatchObject({ name: "Acme updated" });

    await expect(service.syncCompanies([
      { name: "One", careersUrl: "https://example.com/one", platform: undefined },
      { name: "Duplicate", careersUrl: "https://www.example.com/one/", platform: undefined },
    ], context)).rejects.toMatchObject({ code: "duplicate_company_url" });
    expect(database.select().from(companies).all()).toHaveLength(1);
    expect(database.select().from(companies).get()).toMatchObject({ isActive: true });
  });

  it("rolls back company synchronization when a database conflict occurs", async () => {
    const { database } = harness.createDatabase();
    database.insert(companies).values([
      { name: "First", careersUrl: "https://example.com/careers" },
      { name: "Second", careersUrl: "https://example.com/careers/" },
    ]).run();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/people/sync", () => ({ refreshUnmatchedCompanyMappings: vi.fn() }));
    const service = await import("@/lib/application/companies-service");

    await expect(service.syncCompanies([{
      name: "Changed",
      careersUrl: "https://example.com/careers/",
      platform: undefined,
    }], { requestId: "company-conflict-test" })).rejects.toMatchObject({
      code: "duplicate_company_url",
    });
    expect(database.select().from(companies).orderBy(companies.id).all()).toMatchObject([
      { name: "First", careersUrl: "https://example.com/careers", isActive: true },
      { name: "Second", careersUrl: "https://example.com/careers/", isActive: true },
    ]);
  });

  it("owns profile child persistence and rematch scheduling", async () => {
    const { database } = harness.createDatabase();
    const scheduleProfileRematch = vi.fn();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/profile-rematch", () => ({ scheduleProfileRematch }));
    const localProfile = database.insert(profile).values({ name: "Local user" }).returning().get();
    const service = await import("@/lib/application/profile-service");

    const skill = await service.createSkill({ profileId: localProfile.id, name: "TypeScript" });
    await expect(service.updateSkill(skill.id, { category: "Language" })).resolves.toMatchObject({ category: "Language" });
    await expect(service.deleteSkill(skill.id)).resolves.toEqual({ success: true });
    await expect(service.deleteSkill(skill.id)).rejects.toMatchObject({ code: "skill_not_found" });
    expect(scheduleProfileRematch).toHaveBeenCalledTimes(3);
  });

  it("persists parsed education without dates atomically", async () => {
    const { database } = harness.createDatabase();
    const scheduleProfileRematch = vi.fn();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/profile-rematch", () => ({ scheduleProfileRematch }));
    const localProfile = database.insert(profile).values({ name: "Local user" }).returning().get();
    const service = await import("@/lib/application/profile-service");

    await expect(service.createEducation([
      { profileId: localProfile.id, institution: "Example University", degree: "BS" },
      { profileId: 999_999, institution: "Invalid University", degree: "MS" },
    ])).rejects.toThrow();
    expect(database.select().from(education).all()).toEqual([]);

    await expect(service.createEducation([
      { profileId: localProfile.id, institution: "Example University", degree: "BS" },
    ])).resolves.toMatchObject([{ startDate: null }]);
    expect(scheduleProfileRematch).toHaveBeenCalledTimes(1);
  });

  it("applies resume sections idempotently without creating duplicate profile records", async () => {
    const { database } = harness.createDatabase();
    const scheduleProfileRematch = vi.fn();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/profile-rematch", () => ({ scheduleProfileRematch }));
    const localProfile = database.insert(profile).values({ name: "Local user" }).returning().get();
    const service = await import("@/lib/application/profile-service");

    const skillInput = {
      section: "skills" as const,
      profileId: localProfile.id,
      items: [
        { name: "TypeScript", category: "backend" },
        { name: " typescript ", category: "frontend" },
      ],
    };
    await expect(service.applyResumeSection(skillInput)).resolves.toMatchObject({
      added: 1,
      updated: 0,
      duplicatesSkipped: 1,
    });
    await expect(service.applyResumeSection(skillInput)).resolves.toMatchObject({
      added: 0,
      updated: 0,
      unchanged: 1,
      duplicatesSkipped: 1,
    });
    expect(database.select().from(skills).all()).toHaveLength(1);

    const experienceInput = {
      section: "experience" as const,
      profileId: localProfile.id,
      items: [{
        company: "Acme",
        title: "Engineer",
        startDate: "2024-01",
        endDate: null,
        description: "Built the platform",
      }],
    };
    await expect(service.applyResumeSection(experienceInput)).resolves.toMatchObject({
      added: 1,
      updated: 0,
    });
    await expect(service.applyResumeSection({
      ...experienceInput,
      items: [{
        ...experienceInput.items[0],
        location: "Remote",
        description: "Built and scaled the platform",
      }],
    })).resolves.toMatchObject({
      added: 0,
      updated: 1,
    });
    expect(database.select().from(experience).all()).toMatchObject([{
      company: "Acme",
      title: "Engineer",
      location: "Remote",
      description: "Built and scaled the platform",
    }]);
    expect(scheduleProfileRematch).toHaveBeenCalledTimes(3);
  });

  it("converges concurrent initial profile saves on the local singleton", async () => {
    const { database } = harness.createDatabase();
    const scheduleProfileRematch = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/profile-rematch", () => ({ scheduleProfileRematch }));
    const service = await import("@/lib/application/profile-service");

    const saved = await Promise.all([
      service.saveProfile({ name: "Local user", summary: "First profile state" }),
      service.saveProfile({ name: "Local user", summary: "Second profile state" }),
    ]);

    expect(saved).toHaveLength(2);
    expect(database.select().from(profile).all()).toHaveLength(1);
    expect(database.select().from(profile).get()).toMatchObject({
      singletonKey: "local",
      summary: "Second profile state",
    });
    expect(scheduleProfileRematch).toHaveBeenCalledTimes(2);
  });

  it("validates mapped companies and owns person mutations", async () => {
    const { database } = harness.createDatabase();
    const createManualPerson = vi.fn().mockResolvedValue({ id: 77, fullName: "Ada Lovelace" });
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/people/sync", () => ({ createManualPerson, getPeopleList: vi.fn() }));
    const company = database.insert(companies).values({ name: "Acme", careersUrl: "https://example.com/careers" }).returning().get();
    const person = database.insert(people).values({
      source: "manual",
      sourceRecordKey: "manual:ada",
      identityKey: "manual:ada",
      fullName: "Ada Lovelace",
      firstName: "Ada",
      lastName: "Lovelace",
      profileUrl: "https://example.com/ada",
      profileUrlNormalized: "https://example.com/ada",
    }).returning().get();
    const service = await import("@/lib/application/people-service");

    await expect(service.createPerson({ fullName: "Grace Hopper", mappedCompanyId: company.id })).resolves.toMatchObject({ id: 77 });
    await expect(service.createPerson({ fullName: "Missing", mappedCompanyId: 999_999 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.updatePerson(person.id, { isStarred: true, mappedCompanyId: company.id })).resolves.toMatchObject({ isStarred: true, mappedCompanyId: company.id });
    await expect(service.updatePerson(999_999, { isStarred: true })).rejects.toMatchObject({ code: "person_not_found" });
  });
});
