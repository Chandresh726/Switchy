import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("retired API contracts", () => {
  it("keeps collection routes free of replaced resource mutations", () => {
    expect(source("app/api/jobs/route.ts")).not.toMatch(/export async function (PATCH|DELETE)/);
    expect(source("app/api/companies/route.ts")).not.toMatch(/export async function (POST|PUT)/);
    expect(source("app/api/match-history/route.ts")).not.toMatch(/export async function (PATCH|DELETE)/);
    expect(source("app/api/scrape-history/route.ts")).not.toMatch(/export async function (PATCH|DELETE)/);
    expect(source("app/api/profile/skills/route.ts")).not.toContain("export async function DELETE");
    expect(source("app/api/profile/experience/route.ts")).not.toMatch(/export async function (PUT|DELETE)/);
    expect(source("app/api/profile/education/route.ts")).not.toMatch(/export async function (PUT|DELETE)/);
    expect(source("app/api/settings/route.ts")).not.toContain("export async function POST");
  });

  it("keeps clients and documentation free of query-addressed resource URLs", () => {
    const migratedSources = [
      source("lib/api/clients/history.ts"),
      source("lib/api/clients/jobs.ts"),
      source("lib/api/clients/profile.ts"),
      source("docs/scraper-architecture.md"),
    ].join("\n");
    expect(migratedSources).not.toMatch(/\/(?:match|scrape)-history\?sessionId=/);
    expect(migratedSources).not.toMatch(/\/api\/profile\/(?:skills|experience|education|resumes)\?id=/);
  });
});
