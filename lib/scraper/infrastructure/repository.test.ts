import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  selectedRows: [] as Array<{ id: number; description: string | null }>,
  writes: [] as Array<{ table: unknown; values: unknown; condition: unknown }>,
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ op: "inArray", column, values })),
  isNotNull: vi.fn((column: unknown) => ({ column })),
  notInArray: vi.fn((column: unknown, values: unknown[]) => ({
    op: "notInArray",
    column,
    values,
  })),
}));

vi.mock("@/lib/db/schema", () => ({
  companies: { __table: "companies", id: "companies.id", isActive: "companies.isActive" },
  jobs: {
    __table: "jobs",
    id: "jobs.id",
    companyId: "jobs.companyId",
    externalId: "jobs.externalId",
    title: "jobs.title",
    url: "jobs.url",
    location: "jobs.location",
    status: "jobs.status",
    archiveSource: "jobs.archiveSource",
    description: "jobs.description",
  },
  settings: { __table: "settings", key: "settings.key", value: "settings.value" },
  scrapeSessions: {
    __table: "scrapeSessions",
    id: "scrapeSessions.id",
    status: "scrapeSessions.status",
  },
  scrapingLogs: { __table: "scrapingLogs", id: "scrapingLogs.id" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => repositoryMocks.selectedRows),
      })),
    })),
    update: repositoryMocks.update,
    insert: repositoryMocks.insert,
  },
}));

import { DrizzleScraperRepository } from "@/lib/scraper/infrastructure/repository";

describe("DrizzleScraperRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.selectedRows = [];
    repositoryMocks.writes = [];
    repositoryMocks.update.mockImplementation((table: unknown) => ({
      set: (values: unknown) => ({
        where: (condition: unknown) => {
          repositoryMocks.writes.push({ table, values, condition });
          return {
            returning: async () => [{ id: 1 }],
          };
        },
      }),
    }));
  });

  it("preserves requested order while excluding jobs without descriptions", async () => {
    repositoryMocks.selectedRows = [
      { id: 1, description: "Ready to match" },
      { id: 2, description: null },
      { id: 3, description: "   " },
    ];
    const repository = new DrizzleScraperRepository();

    await expect(repository.getMatchableJobIds([3, 2, 1])).resolves.toEqual([1]);
  });

  it("does not issue archive or reopen writes for empty policies", async () => {
    const repository = new DrizzleScraperRepository();

    await expect(repository.archiveMissingJobs(1, [], [])).resolves.toBe(0);
    await expect(repository.reopenScraperArchivedJobs(1, [])).resolves.toBe(0);
    expect(repositoryMocks.update).not.toHaveBeenCalled();
  });

  it("archives only configured statuses while excluding authoritative open IDs", async () => {
    const repository = new DrizzleScraperRepository();

    await expect(
      repository.archiveMissingJobs(7, ["greenhouse-acme-open"], ["new", "viewed"])
    ).resolves.toBe(1);

    expect(repositoryMocks.writes).toHaveLength(1);
    const condition = JSON.stringify(repositoryMocks.writes[0]?.condition);
    expect(condition).toContain(
      '{"op":"notInArray","column":"jobs.externalId","values":["greenhouse-acme-open"]}'
    );
    expect(condition).toContain(
      '{"op":"inArray","column":"jobs.status","values":["new","viewed"]}'
    );
  });

  it("archives all configured statuses when the authoritative open set is empty", async () => {
    const repository = new DrizzleScraperRepository();

    await expect(repository.archiveMissingJobs(7, [], ["new"])).resolves.toBe(1);

    const condition = JSON.stringify(repositoryMocks.writes[0]?.condition);
    expect(condition).toContain('{"op":"inArray","column":"jobs.status","values":["new"]}');
    expect(condition).not.toContain("greenhouse-acme-open");
  });

  it("reopens only matching jobs previously archived by the scraper", async () => {
    const repository = new DrizzleScraperRepository();

    await expect(
      repository.reopenScraperArchivedJobs(7, ["greenhouse-acme-open"])
    ).resolves.toBe(1);

    const condition = JSON.stringify(repositoryMocks.writes[0]?.condition);
    expect(condition).toContain('"value":"archived"');
    expect(condition).toContain('"value":"scraper"');
    expect(condition).toContain(
      '{"op":"inArray","column":"jobs.externalId","values":["greenhouse-acme-open"]}'
    );
  });
});
