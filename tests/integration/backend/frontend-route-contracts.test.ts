import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  companiesResponseSchema,
  companyImportResponseSchema,
  companyWriteResponseSchema,
} from "@/lib/api/contracts/companies";
import {
  jobSchema,
  jobsResponseSchema,
  jobUpdateResponseSchema,
} from "@/lib/api/contracts/jobs";
import {
  peopleListResponseSchema,
  personResponseSchema,
} from "@/lib/api/contracts/people";
import {
  profileResponseSchema,
  profileSchema,
  skillSchema,
  skillsResponseSchema,
} from "@/lib/api/contracts/profile";
import { settingsResponseSchema } from "@/lib/api/contracts/settings";
import { companies, jobs } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-frontend-route-contracts-");

vi.mock("server-only", () => ({}));

function mutationRequest(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-switchy-request": "true",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/matcher/presentation");
  vi.doUnmock("@/lib/ai/matcher/profile-rematch");
  vi.doUnmock("@/lib/people/sync");
  vi.resetModules();
});

describe("actual frontend route contract compatibility", () => {
  it("serializes real job list, detail, and mutation service output", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/presentation", () => ({
      getCurrentMatchContext: vi.fn().mockResolvedValue(null),
      getMatchPresentations: vi.fn().mockImplementation(
        async (rows: Array<{ id: number; matchScore: number | null }>) =>
          new Map(rows.map((row) => [row.id, {
            matchScore: row.matchScore,
            matchReasons: [],
            matchedSkills: [],
            matchResultId: null,
            matchBreakdown: null,
            matchStale: false,
            matchLegacy: false,
            matchSummary: "",
            matchReasoning: [],
            matchRunId: null,
            matchPolicyVersion: null,
            scoringPolicyVersion: null,
          }]))
      ),
    }));
    const company = database.insert(companies).values({
      name: "Contract Co",
      careersUrl: "https://example.com/contracts",
    }).returning().get();
    const job = database.insert(jobs).values({
      companyId: company.id,
      title: "Contract Engineer",
      description: "Detail-only description",
      url: "https://example.com/contracts/1",
    }).returning().get();
    const [{ GET: listJobs }, jobRoute] = await Promise.all([
      import("@/app/api/jobs/route"),
      import("@/app/api/jobs/[id]/route"),
    ]);

    const listResponse = await listJobs(
      new NextRequest("http://localhost/api/jobs?limit=20&offset=0")
    );
    const listPayload = jobsResponseSchema.parse(await listResponse.json());
    expect(listPayload.jobs).toHaveLength(1);
    expect(listPayload.jobs[0]).not.toHaveProperty("description");

    const detailResponse = await jobRoute.GET(
      new NextRequest(`http://localhost/api/jobs/${job.id}`),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    expect(jobSchema.parse(await detailResponse.json())).toMatchObject({
      id: job.id,
      description: "Detail-only description",
      matchReasons: [],
      matchedSkills: [],
    });

    const updateResponse = await jobRoute.PATCH(
      mutationRequest(`/api/jobs/${job.id}`, "PATCH", { status: "applied" }),
      { params: Promise.resolve({ id: String(job.id) }) }
    );
    expect(jobUpdateResponseSchema.parse(await updateResponse.json())).toMatchObject({
      id: job.id,
      status: "applied",
    });
  });

  it("serializes real company reads and writes from temporary state", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/people/sync", () => ({
      refreshUnmatchedCompanyMappings: vi.fn().mockResolvedValue({
        mappedPeopleCount: 0,
        mappedCompanyCount: 0,
      }),
    }));
    const [collectionRoute, importRoute, companyRoute] = await Promise.all([
      import("@/app/api/companies/route"),
      import("@/app/api/companies/import/route"),
      import("@/app/api/companies/[id]/route"),
    ]);

    const createResponse = await importRoute.POST(mutationRequest(
      "/api/companies/import",
      "POST",
      { name: "Contract Co", careersUrl: "https://example.com/careers" }
    ));
    const created = companyImportResponseSchema.parse(await createResponse.json());
    expect(Array.isArray(created)).toBe(false);
    if (Array.isArray(created)) throw new Error("Expected one company");

    const listResponse = await collectionRoute.GET(
      new NextRequest("http://localhost/api/companies")
    );
    expect(companiesResponseSchema.parse(await listResponse.json())).toHaveLength(1);

    const patchResponse = await companyRoute.PATCH(
      mutationRequest(`/api/companies/${created.id}`, "PATCH", { notes: "Reviewed" }),
      { params: Promise.resolve({ id: String(created.id) }) }
    );
    expect(companyWriteResponseSchema.parse(await patchResponse.json())).toMatchObject({
      id: created.id,
      notes: "Reviewed",
    });
  });

  it("serializes real profile and profile-child mutations from temporary state", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    vi.doMock("@/lib/ai/matcher/profile-rematch", () => ({
      scheduleProfileRematch: vi.fn().mockResolvedValue(undefined),
    }));
    const [profileRoute, skillsRoute, skillRoute] = await Promise.all([
      import("@/app/api/profile/route"),
      import("@/app/api/profile/skills/route"),
      import("@/app/api/profile/skills/[id]/route"),
    ]);

    const saveResponse = await profileRoute.POST(mutationRequest(
      "/api/profile",
      "POST",
      { name: "Local Contract User", summary: "Temporary test state" }
    ));
    const saved = profileSchema.parse(await saveResponse.json());

    const createSkillResponse = await skillsRoute.POST(mutationRequest(
      "/api/profile/skills",
      "POST",
      { profileId: saved.id, name: "TypeScript" }
    ));
    const skill = skillSchema.parse(await createSkillResponse.json());
    const updateSkillResponse = await skillRoute.PATCH(
      mutationRequest(`/api/profile/skills/${skill.id}`, "PATCH", { category: "Language" }),
      { params: Promise.resolve({ id: String(skill.id) }) }
    );
    expect(skillSchema.parse(await updateSkillResponse.json())).toMatchObject({
      id: skill.id,
      category: "Language",
    });

    const skillsResponse = await skillsRoute.GET(
      new NextRequest(`http://localhost/api/profile/skills?profileId=${saved.id}`)
    );
    expect(skillsResponseSchema.parse(await skillsResponse.json())).toHaveLength(1);
    const profileResponse = await profileRoute.GET(
      new NextRequest("http://localhost/api/profile")
    );
    expect(profileResponseSchema.parse(await profileResponse.json())).toMatchObject({
      id: saved.id,
      skills: [{ id: skill.id, category: "Language" }],
    });
  });

  it("serializes real people and settings mutations from temporary state", async () => {
    const { database } = harness.createDatabase();
    vi.doMock("@/lib/db", () => ({ db: database }));
    const mappedCompany = database.insert(companies).values({
      name: "Mapped Contract Co",
      careersUrl: "https://example.com/mapped-contracts",
    }).returning().get();
    const [peopleRoute, personRoute, settingsRoute] = await Promise.all([
      import("@/app/api/people/route"),
      import("@/app/api/people/[id]/route"),
      import("@/app/api/settings/route"),
    ]);

    const createPersonResponse = await peopleRoute.POST(mutationRequest(
      "/api/people",
      "POST",
      {
        fullName: "Temporary Person",
        email: "temporary@example.com",
        mappedCompanyId: mappedCompany.id,
      }
    ));
    const person = personResponseSchema.parse(await createPersonResponse.json());
    expect(person).toMatchObject({
      fullName: "Temporary Person",
      email: "temporary@example.com",
      company: { id: mappedCompany.id, name: "Mapped Contract Co" },
    });
    const updatePersonResponse = await personRoute.PATCH(
      mutationRequest(`/api/people/${person.id}`, "PATCH", { isStarred: true }),
      { params: Promise.resolve({ id: String(person.id) }) }
    );
    expect(personResponseSchema.parse(await updatePersonResponse.json())).toMatchObject({
      id: person.id,
      isStarred: true,
      company: { id: mappedCompany.id, name: "Mapped Contract Co" },
    });
    const peopleResponse = await peopleRoute.GET(
      new NextRequest("http://localhost/api/people?limit=20&offset=0")
    );
    expect(peopleListResponseSchema.parse(await peopleResponse.json())).toMatchObject({
      totalCount: 1,
      people: [{ fullName: "Temporary Person" }],
    });

    const settingsResponse = await settingsRoute.PATCH(mutationRequest(
      "/api/settings",
      "PATCH",
      { scraper_filter_city: "Bengaluru" }
    ));
    expect(settingsResponseSchema.parse(await settingsResponse.json())).toMatchObject({
      scraper_filter_city: "Bengaluru",
    });
    const readSettingsResponse = await settingsRoute.GET(
      new NextRequest("http://localhost/api/settings")
    );
    expect(settingsResponseSchema.parse(await readSettingsResponse.json())).toMatchObject({
      scraper_filter_city: "Bengaluru",
    });
  });
});
