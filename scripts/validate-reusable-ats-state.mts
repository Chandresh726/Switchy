import { parseArgs } from "node:util";

import Database from "better-sqlite3";
import { count, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import * as schema from "@/lib/db/schema";
import {
  companies,
  jobs,
  matchResults,
  matchSessionJobs,
  matchSessions,
  people,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import { stateCliArguments } from "@/lib/state/cli-arguments";

const phaseSchema = z.enum(["before", "after"]);

const EXPECTED_COMPANIES = [
  {
    name: "Nutanix",
    canonicalUrl: "https://jobs.jobvite.com/nutanix/jobs",
    platform: "jobvite",
    boardToken: "nutanix",
    aliases: ["nutanix"],
    urls: ["https://careers.nutanix.com/en/jobs/"],
  },
  {
    name: "LegalZoom",
    canonicalUrl: "https://jobs.jobvite.com/legalzoom/jobs",
    platform: "jobvite",
    boardToken: "legalzoom",
    aliases: ["legalzoom"],
    urls: ["https://www.legalzoom.com/careers#open-positions"],
  },
  {
    name: "Intuit",
    canonicalUrl: "https://jobs.intuit.com/search-jobs",
    platform: "talentbrew",
    boardToken: "27595",
    aliases: ["intuit"],
    urls: ["https://careers.intuit.com/"],
  },
  {
    name: "Goldman Sachs",
    canonicalUrl:
      "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs",
    platform: "oracle",
    boardToken: "hdpc.fa.us2.oraclecloud.com/CX_3002",
    aliases: ["goldman sach", "goldman sachs"],
    urls: ["https://higher.gs.com/results"],
  },
  {
    name: "eBay",
    canonicalUrl: "https://jobs.ebayinc.com/us/en/search-results",
    platform: "phenom",
    boardToken: "EBAEBAUS",
    aliases: ["ebay"],
    urls: ["https://jobs.ebayinc.com/us/en/jobs-in-india"],
  },
] as const;

function normalizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    return `${parsed.origin.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

const { values } = parseArgs({
  args: stateCliArguments(),
  options: {
    database: { type: "string" },
    phase: { type: "string" },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.database) throw new Error("Missing required --database path");
const phase = phaseSchema.parse(values.phase);
const sqlite = new Database(values.database, { readonly: true, fileMustExist: true });
const database = drizzle(sqlite, { schema });

try {
  const storedCompanies = database.select().from(companies).all();
  const errors: string[] = [];
  const relevantCompanies = EXPECTED_COMPANIES.flatMap((expected) => {
    const acceptedUrls = [expected.canonicalUrl, ...expected.urls].map(normalizeUrl);
    const matches = storedCompanies.filter((company) => {
      const normalizedName = company.name.trim().toLowerCase();
      const normalizedUrl = normalizeUrl(company.careersUrl);
      return (expected.aliases as readonly string[]).includes(normalizedName) ||
        acceptedUrls.includes(normalizedUrl);
    });
    if (matches.length !== 1) {
      errors.push(`${expected.name} matched ${matches.length} company rows`);
    }
    const company = matches[0];
    if (!company) return [];

    const canonicalOwners = storedCompanies.filter(
      (candidate) =>
        normalizeUrl(candidate.careersUrl) === normalizeUrl(expected.canonicalUrl)
    );
    if (canonicalOwners.some((owner) => owner.id !== company.id)) {
      errors.push(`${expected.name} canonical URL belongs to another company row`);
    }
    if (
      phase === "after" &&
      (company.name !== expected.name ||
        company.careersUrl !== expected.canonicalUrl ||
        company.platform !== expected.platform ||
        company.boardToken !== expected.boardToken)
    ) {
      errors.push(`${expected.name} does not have its canonical post-migration mapping`);
    }
    return [{ expected, company }];
  });

  const relevantIds = relevantCompanies.map(({ company }) => company.id);
  const relevantJobs = relevantIds.length > 0
    ? database.select({
        id: jobs.id,
        companyId: jobs.companyId,
        externalId: jobs.externalId,
      }).from(jobs).where(inArray(jobs.companyId, relevantIds)).all()
    : [];
  const externalIdentityCounts = new Map<string, number>();
  for (const job of relevantJobs) {
    if (!job.externalId) continue;
    const key = `${job.companyId}:${job.externalId}`;
    externalIdentityCounts.set(key, (externalIdentityCounts.get(key) ?? 0) + 1);
  }
  if (Array.from(externalIdentityCounts.values()).some((value) => value > 1)) {
    errors.push("relevant companies contain duplicate external job identities");
  }

  const nutanixId = relevantCompanies.find(({ expected }) => expected.name === "Nutanix")
    ?.company.id;
  const nutanixJobs = relevantJobs.filter((job) => job.companyId === nutanixId);
  const postMigrationNutanixIdentities = nutanixJobs
    .map((job) => job.externalId)
    .filter((externalId): externalId is string => Boolean(externalId))
    .map((externalId) =>
      externalId.replace(/^nutanix-nutanix-/u, "jobvite-nutanix-")
    );
  if (
    new Set(postMigrationNutanixIdentities).size !==
    postMigrationNutanixIdentities.length
  ) {
    errors.push("Nutanix external job identities would collide after migration");
  }
  const summary = {
    phase,
    counts: {
      companies: database.select({ value: count() }).from(companies).get()?.value ?? 0,
      jobs: database.select({ value: count() }).from(jobs).get()?.value ?? 0,
      scrapeSessions:
        database.select({ value: count() }).from(scrapeSessions).get()?.value ?? 0,
      scrapingLogs:
        database.select({ value: count() }).from(scrapingLogs).get()?.value ?? 0,
      matchSessions:
        database.select({ value: count() }).from(matchSessions).get()?.value ?? 0,
      matchSessionJobs:
        database.select({ value: count() }).from(matchSessionJobs).get()?.value ?? 0,
      matchResults:
        database.select({ value: count() }).from(matchResults).get()?.value ?? 0,
      people: database.select({ value: count() }).from(people).get()?.value ?? 0,
    },
    companies: relevantCompanies.map(({ company }) => ({
      id: company.id,
      name: company.name,
      careersUrl: company.careersUrl,
      platform: company.platform,
      boardToken: company.boardToken,
      jobs: relevantJobs.filter((job) => job.companyId === company.id).length,
    })),
    nutanixIdentities: {
      legacy: nutanixJobs.filter((job) =>
        job.externalId?.startsWith("nutanix-nutanix-")
      ).length,
      jobvite: nutanixJobs.filter((job) =>
        job.externalId?.startsWith("jobvite-nutanix-")
      ).length,
    },
    errors,
  };
  console.log(JSON.stringify(summary));
  if (errors.length > 0) process.exitCode = 1;
} finally {
  sqlite.close();
}
