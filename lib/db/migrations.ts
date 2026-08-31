import type Database from "better-sqlite3";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type * as databaseSchema from "./schema";
import {
  aiCacheEvents,
  aiGeneratedContent,
  aiGenerationEvents,
  aiGenerationHistory,
  aiProviders,
  aiRuns,
  companies,
  matchLogs,
  matchResults,
  matchSessionJobs,
  jobs,
  settings,
} from "./schema";

const FLIPKART_TURBOHIRE_URL =
  "https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f";
const FLIPKART_TURBOHIRE_ORGANIZATION_ID =
  "4d757ba0-3d57-448a-b82c-238ed87ac90f";
const LEGACY_FLIPKART_URL = "https://www.flipkartcareers.com/flipkart/jobslist";

interface ReusableScraperCompanyMigration {
  canonicalName: string;
  canonicalUrl: string;
  platform: "jobvite" | "talentbrew" | "oracle" | "phenom";
  boardToken: string;
  legacyNames: string[];
  legacyUrls: string[];
}

const REUSABLE_SCRAPER_COMPANY_MIGRATIONS: ReusableScraperCompanyMigration[] = [
  {
    canonicalName: "Nutanix",
    canonicalUrl: "https://jobs.jobvite.com/nutanix/jobs",
    platform: "jobvite",
    boardToken: "nutanix",
    legacyNames: ["nutanix"],
    legacyUrls: ["https://careers.nutanix.com/en/jobs/"],
  },
  {
    canonicalName: "LegalZoom",
    canonicalUrl: "https://jobs.jobvite.com/legalzoom/jobs",
    platform: "jobvite",
    boardToken: "legalzoom",
    legacyNames: ["legalzoom"],
    legacyUrls: ["https://www.legalzoom.com/careers#open-positions"],
  },
  {
    canonicalName: "Intuit",
    canonicalUrl: "https://jobs.intuit.com/search-jobs",
    platform: "talentbrew",
    boardToken: "27595",
    legacyNames: ["intuit"],
    legacyUrls: ["https://careers.intuit.com/"],
  },
  {
    canonicalName: "Goldman Sachs",
    canonicalUrl:
      "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs",
    platform: "oracle",
    boardToken: "hdpc.fa.us2.oraclecloud.com/CX_3002",
    legacyNames: ["goldman sach", "goldman sachs"],
    legacyUrls: ["https://higher.gs.com/results"],
  },
  {
    canonicalName: "eBay",
    canonicalUrl: "https://jobs.ebayinc.com/us/en/search-results",
    platform: "phenom",
    boardToken: "EBAEBAUS",
    legacyNames: ["ebay"],
    legacyUrls: ["https://jobs.ebayinc.com/us/en/jobs-in-india"],
  },
];

interface ProviderMigrationRecord {
  id: string;
  provider: string;
  isActive: boolean | null;
  isDefault: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("no such table");
}

function reconcileDuplicateNonCustomProviders(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  let providers: ProviderMigrationRecord[];
  try {
    providers = database.select({
      id: aiProviders.id,
      provider: aiProviders.provider,
      isActive: aiProviders.isActive,
      isDefault: aiProviders.isDefault,
      createdAt: aiProviders.createdAt,
      updatedAt: aiProviders.updatedAt,
    }).from(aiProviders)
      .where(ne(aiProviders.provider, "custom"))
      .orderBy(
        desc(aiProviders.isDefault),
        desc(aiProviders.isActive),
        desc(aiProviders.updatedAt),
        asc(aiProviders.createdAt),
        asc(aiProviders.id)
      ).all();
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  const groups = new Map<string, ProviderMigrationRecord[]>();
  for (const provider of providers) {
    const group = groups.get(provider.provider) ?? [];
    group.push(provider);
    groups.set(provider.provider, group);
  }
  if (Array.from(groups.values()).every((group) => group.length < 2)) return;

  database.transaction((tx) => {
    for (const duplicates of groups.values()) {
      const survivor = duplicates[0];
      if (!survivor || duplicates.length < 2) continue;
      for (const duplicate of duplicates.slice(1)) {
        tx.update(settings).set({ value: survivor.id })
          .where(eq(settings.value, duplicate.id)).run();
        tx.delete(settings)
          .where(eq(settings.key, `provider_model_catalog:${duplicate.id}`)).run();
        try {
          tx.update(aiRuns).set({ providerRecordId: survivor.id })
            .where(eq(aiRuns.providerRecordId, duplicate.id)).run();
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
        }
        tx.delete(aiProviders).where(eq(aiProviders.id, duplicate.id)).run();
      }
    }
  });
}

function backfillAICacheEvents(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  const legacyBackfillKey = "migration:ai_cache_events_v1";
  try {
    database.delete(settings).where(eq(settings.key, legacyBackfillKey)).run();
    if (database.select({ id: aiCacheEvents.id }).from(aiCacheEvents).limit(1).get()) return;
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  database.transaction((tx) => {
    const cachedAnalyses = tx.select({
      sessionId: matchSessionJobs.sessionId,
      jobId: matchSessionJobs.jobId,
      sourceRunId: matchSessionJobs.analysisRunId,
      artifactId: matchSessionJobs.jobAnalysisId,
      createdAt: matchSessionJobs.analysisCompletedAt,
    }).from(matchSessionJobs)
      .where(eq(matchSessionJobs.analysisStatus, "cached"))
      .all();
    for (const cached of cachedAnalyses) {
      if (!cached.artifactId) continue;
      tx.insert(aiCacheEvents).values({
        id: `legacy:analysis:${cached.sessionId}:${cached.jobId}`,
        capability: "job_analysis",
        subjectType: "job",
        subjectId: String(cached.jobId),
        sourceRunId: cached.sourceRunId,
        artifactType: "job_analysis",
        artifactId: cached.artifactId,
        sessionId: cached.sessionId,
        createdAt: cached.createdAt ?? new Date(),
      }).onConflictDoNothing().run();
    }

    const cachedMatches = tx.select({
      logId: matchLogs.id,
      sessionId: matchLogs.sessionId,
      jobId: matchLogs.jobId,
      artifactId: matchLogs.matchResultId,
      sourceRunId: matchResults.matchRunId,
      createdAt: matchLogs.completedAt,
    }).from(matchLogs)
      .leftJoin(matchResults, eq(matchLogs.matchResultId, matchResults.id))
      .where(eq(matchLogs.modelUsed, "cache"))
      .all();
    for (const cached of cachedMatches) {
      if (!cached.jobId || !cached.artifactId) continue;
      tx.insert(aiCacheEvents).values({
        id: `legacy:match:${cached.logId}`,
        capability: "match_evaluation",
        subjectType: "job",
        subjectId: String(cached.jobId),
        sourceRunId: cached.sourceRunId,
        artifactType: "match_result",
        artifactId: cached.artifactId,
        sessionId: cached.sessionId,
        createdAt: cached.createdAt ?? new Date(),
      }).onConflictDoNothing().run();
    }
  });
}

function backfillWritingEvents(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  const legacyBackfillKey = "migration:ai_generation_events_v1";
  try {
    database.delete(settings).where(eq(settings.key, legacyBackfillKey)).run();
    if (
      database.select({ id: aiGenerationEvents.id })
        .from(aiGenerationEvents)
        .limit(1)
        .get()
    ) return;
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  database.transaction((tx) => {
    const variants = tx.select().from(aiGenerationHistory).all();
    for (const variant of variants) {
      if (variant.selectedAt) {
        tx.insert(aiGenerationEvents).values({
          variantId: variant.id,
          action: "selected",
          source: "generated",
          createdAt: variant.selectedAt,
        }).run();
      }
      if (variant.copiedAt) {
        tx.insert(aiGenerationEvents).values({
          variantId: variant.id,
          action: "copied",
          source: "copy",
          createdAt: variant.copiedAt,
        }).run();
      }
      if (variant.discardedAt) {
        tx.insert(aiGenerationEvents).values({
          variantId: variant.id,
          action: "discarded",
          source: "discard",
          createdAt: variant.discardedAt,
        }).run();
      }
    }

    const contents = tx.select({ id: aiGeneratedContent.id })
      .from(aiGeneratedContent)
      .where(isNull(aiGeneratedContent.currentVariantId))
      .all();
    for (const content of contents) {
      const latest = tx.select({ id: aiGenerationHistory.id })
        .from(aiGenerationHistory)
        .where(and(
          eq(aiGenerationHistory.contentId, content.id),
          isNull(aiGenerationHistory.discardedAt)
        ))
        .orderBy(desc(aiGenerationHistory.createdAt), desc(aiGenerationHistory.id))
        .limit(1)
        .get();
      if (latest) {
        tx.update(aiGeneratedContent).set({ currentVariantId: latest.id })
          .where(eq(aiGeneratedContent.id, content.id))
          .run();
      }
    }
  });
}

export function migrateLegacyScraperCompanies(
  database: BetterSQLite3Database<typeof databaseSchema>
): void {
  let storedCompanies: Array<typeof companies.$inferSelect>;
  try {
    storedCompanies = database.select().from(companies).all();
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }

  const legacyCompanies = storedCompanies.filter(
    (company) => company.platform?.trim().toLowerCase() === "zwayam"
  );
  const canonicalFlipkart = storedCompanies.find(
    (company) => company.careersUrl === FLIPKART_TURBOHIRE_URL
  );
  const legacyFlipkart = legacyCompanies.find(
    (company) =>
      company.careersUrl === LEGACY_FLIPKART_URL ||
      company.name.trim().toLowerCase() === "flipkart"
  );
  for (const migration of REUSABLE_SCRAPER_COMPANY_MIGRATIONS) {
    const matches = storedCompanies.filter((company) =>
      reusableMigrationMatchesCompany(migration, company)
    );
    if (matches.length > 1) {
      throw new Error(
        `Reusable scraper migration found ${matches.length} company rows for ${migration.canonicalName}; resolve the duplicate before migration.`
      );
    }
    const target = matches[0];
    if (migration.boardToken === "nutanix" && target) {
      const storedJobs = database.select({
        externalId: jobs.externalId,
      }).from(jobs).where(eq(jobs.companyId, target.id)).all();
      const currentExternalIds = new Set(
        storedJobs
          .map((job) => job.externalId)
          .filter((externalId): externalId is string => Boolean(externalId))
      );
      for (const job of storedJobs) {
        const migratedExternalId = toJobviteNutanixExternalId(job.externalId);
        if (
          migratedExternalId &&
          migratedExternalId !== job.externalId &&
          currentExternalIds.has(migratedExternalId)
        ) {
          throw new Error(
            `Reusable scraper migration cannot transform Nutanix job ${job.externalId}; ${migratedExternalId} already exists.`
          );
        }
      }
    }
  }
  const now = new Date();

  database.transaction((tx) => {
    if (legacyCompanies.length > 0 && canonicalFlipkart) {
      tx.update(companies)
        .set({
          platform: "turbohire",
          boardToken: FLIPKART_TURBOHIRE_ORGANIZATION_ID,
          updatedAt: now,
        })
        .where(eq(companies.id, canonicalFlipkart.id))
        .run();
    } else if (legacyCompanies.length > 0 && legacyFlipkart) {
      tx.update(companies)
        .set({
          careersUrl: FLIPKART_TURBOHIRE_URL,
          platform: "turbohire",
          boardToken: FLIPKART_TURBOHIRE_ORGANIZATION_ID,
          updatedAt: now,
        })
        .where(eq(companies.id, legacyFlipkart.id))
        .run();
    }

    for (const company of legacyCompanies) {
      if (company.id === canonicalFlipkart?.id) continue;
      if (!canonicalFlipkart && company.id === legacyFlipkart?.id) continue;
      tx.update(companies)
        .set({
          platform: "custom",
          isActive: false,
          updatedAt: now,
        })
        .where(eq(companies.id, company.id))
        .run();
    }

    for (const migration of REUSABLE_SCRAPER_COMPANY_MIGRATIONS) {
      const target = storedCompanies.find((company) =>
        reusableMigrationMatchesCompany(migration, company)
      );
      if (!target) continue;

      const careersUrl = migration.canonicalUrl;
      const needsCompanyUpdate =
        target.name !== migration.canonicalName ||
        target.careersUrl !== careersUrl ||
        target.platform !== migration.platform ||
        target.boardToken !== migration.boardToken;

      if (needsCompanyUpdate) {
        tx.update(companies)
          .set({
            name: migration.canonicalName,
            careersUrl,
            platform: migration.platform,
            boardToken: migration.boardToken,
            updatedAt: now,
          })
          .where(eq(companies.id, target.id))
          .run();
      }

      if (migration.boardToken !== "nutanix") continue;
      const nutanixJobs = tx.select({
        id: jobs.id,
        externalId: jobs.externalId,
      }).from(jobs).where(eq(jobs.companyId, target.id)).all();
      for (const job of nutanixJobs) {
        const externalId = toJobviteNutanixExternalId(job.externalId);
        if (!externalId || externalId === job.externalId) continue;
        tx.update(jobs)
          .set({ externalId, updatedAt: now })
          .where(eq(jobs.id, job.id))
          .run();
      }
    }
  });
}

function normalizeMigrationUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    return `${parsed.origin.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function reusableMigrationMatchesCompany(
  migration: ReusableScraperCompanyMigration,
  company: typeof companies.$inferSelect
): boolean {
  const normalizedName = company.name.trim().toLowerCase();
  if (migration.legacyNames.includes(normalizedName)) return true;

  const normalizedUrl = normalizeMigrationUrl(company.careersUrl);
  return [migration.canonicalUrl, ...migration.legacyUrls].some(
    (url) => normalizedUrl === normalizeMigrationUrl(url)
  );
}

function toJobviteNutanixExternalId(externalId: string | null): string | null {
  if (!externalId?.startsWith("nutanix-nutanix-")) return externalId;
  return externalId.replace(/^nutanix-nutanix-/u, "jobvite-nutanix-");
}

export function migrateLocalDatabase(
  database: BetterSQLite3Database<typeof databaseSchema>,
  migrationsFolder: string
): void {
  const sqlite = (database as unknown as { $client: Database.Database }).$client;
  sqlite.pragma("foreign_keys = OFF");
  try {
    reconcileDuplicateNonCustomProviders(database);
    migrate(database, { migrationsFolder });
    migrateLegacyScraperCompanies(database);
    backfillAICacheEvents(database);
    backfillWritingEvents(database);
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  const foreignKeyViolations = sqlite.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(`Migration left ${foreignKeyViolations.length} foreign-key violation(s)`);
  }
  const integrity = sqlite.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("Migration failed SQLite integrity validation");
  }
}
