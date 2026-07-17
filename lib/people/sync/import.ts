import { randomUUID } from "crypto";
import { and, eq, notInArray, sql } from "drizzle-orm";

import { parseApolloCsv, type ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
import { parseLinkedinCsv } from "@/lib/people/import/parsers/linkedin";
import { normalizeCompanyName, normalizeLinkedInProfileUrl } from "@/lib/people/normalize";
import type { PersonImportSummary, PersonSource, ImportMode } from "@/lib/people/types";
import { db } from "@/lib/db";
import { companies, companyAliases, people, peopleImportSessions } from "@/lib/db/schema";

type CsvImportSource = Exclude<PersonSource, "manual">;

export interface ImportPeopleCsvInput {
  source: CsvImportSource;
  content: string;
  fileName: string;
  mapping?: ApolloColumnMapping;
  importMode?: ImportMode;
}

export interface ManualPersonInput {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  profileUrl?: string | null;
  email?: string | null;
  companyRaw?: string | null;
  position?: string | null;
  notes?: string | null;
  mappedCompanyId?: number | null;
}

function parseCsvBySource(input: ImportPeopleCsvInput) {
  if (input.source === "linkedin") {
    return parseLinkedinCsv(input.content);
  }

  if (!input.mapping) {
    throw new Error("Apollo import requires mapping");
  }

  return parseApolloCsv(input.content, input.mapping);
}

export async function importPeopleCsv(input: ImportPeopleCsvInput): Promise<PersonImportSummary> {
  const sessionId = randomUUID();
  const startedAt = new Date();
  let totalRows = 0;
  let invalidRows = 0;

  try {
    const parsed = parseCsvBySource(input);
    totalRows = parsed.totalRows;
    invalidRows = parsed.errors.length;
    if (parsed.rows.length === 0) {
      throw new Error("CSV file contains no valid people rows");
    }
    return db.transaction((tx) => {
      const now = new Date();
      const trackedCompanies = tx.select({ id: companies.id, name: companies.name })
        .from(companies).all();
      const companyMap = new Map<string, number>();
      for (const company of trackedCompanies) {
        const normalized = normalizeCompanyName(company.name);
        if (normalized) companyMap.set(normalized, company.id);
      }
      const aliases = tx.select({
        companyNormalized: companyAliases.companyNormalized,
        mappedCompanyId: companyAliases.mappedCompanyId,
      }).from(companyAliases).all();
      for (const alias of aliases) {
        if (alias.companyNormalized && !companyMap.has(alias.companyNormalized)) {
          companyMap.set(alias.companyNormalized, alias.mappedCompanyId);
        }
      }

      const existingPeople = tx.select({
        id: people.id,
        identityKey: people.identityKey,
        mappedCompanyId: people.mappedCompanyId,
        email: people.email,
      }).from(people).where(eq(people.source, input.source)).all();
      const existingMap = new Map(existingPeople.map((item) => [item.identityKey, item]));
      const seenIdentityKeys = new Set<string>();
      const toInsert: (typeof people.$inferInsert)[] = [];
      const toUpdate: { id: number; data: Partial<typeof people.$inferSelect> }[] = [];
      const importMode = input.importMode ?? "merge";
      let unmatchedCompanyRows = 0;

      for (const row of parsed.rows) {
        seenIdentityKeys.add(row.identityKey);
        const csvMappedCompanyId = row.companyNormalized
          ? (companyMap.get(row.companyNormalized) ?? null)
          : null;
        if (row.companyNormalized && !csvMappedCompanyId) unmatchedCompanyRows += 1;
        const existing = existingMap.get(row.identityKey);
        const commonData = {
          source: row.source,
          sourceRecordKey: row.sourceRecordKey,
          firstName: row.firstName,
          lastName: row.lastName,
          fullName: row.fullName,
          profileUrl: row.profileUrl || "",
          profileUrlNormalized: row.profileUrlNormalized || "",
          email: row.email,
          companyRaw: row.companyRaw,
          companyNormalized: row.companyNormalized,
          position: row.position,
          connectedOn: row.connectedOn,
          notes: row.notes,
          mappedCompanyId: csvMappedCompanyId,
          isActive: true,
          lastSeenAt: now,
          updatedAt: now,
        } as const;
        if (existing) {
          const preserve = importMode === "merge";
          toUpdate.push({
            id: existing.id,
            data: {
              ...commonData,
              mappedCompanyId: preserve
                ? (existing.mappedCompanyId ?? csvMappedCompanyId)
                : csvMappedCompanyId,
              email: preserve ? (existing.email ?? row.email) : row.email,
            },
          });
        } else {
          toInsert.push({
            identityKey: row.identityKey,
            ...commonData,
            isStarred: false,
            createdAt: now,
          });
        }
      }

      const BATCH_SIZE = 500;
      for (let index = 0; index < toInsert.length; index += BATCH_SIZE) {
        tx.insert(people).values(toInsert.slice(index, index + BATCH_SIZE)).run();
      }
      for (const item of toUpdate) {
        tx.update(people).set(item.data).where(eq(people.id, item.id)).run();
      }

      let deactivatedRows = 0;
      if (importMode === "replace") {
        const toDeactivate = tx.select({ id: people.id }).from(people).where(and(
          eq(people.source, input.source),
          eq(people.isActive, true),
          notInArray(people.identityKey, [...seenIdentityKeys])
        )).all();
        if (toDeactivate.length > 0) {
          tx.update(people).set({ isActive: false, updatedAt: now }).where(and(
            eq(people.source, input.source),
            eq(people.isActive, true),
            notInArray(people.identityKey, [...seenIdentityKeys])
          )).run();
          deactivatedRows = toDeactivate.length;
        }
      }

      const summary: PersonImportSummary = {
        sessionId,
        source: input.source,
        fileName: input.fileName,
        totalRows: parsed.totalRows,
        insertedRows: toInsert.length,
        updatedRows: toUpdate.length,
        deactivatedRows,
        invalidRows: parsed.errors.length,
        unmatchedCompanyRows,
        errors: parsed.errors.slice(0, 100),
      };
      tx.insert(peopleImportSessions).values({
        id: sessionId,
        source: summary.source,
        fileName: summary.fileName,
        totalRows: summary.totalRows,
        insertedRows: summary.insertedRows,
        updatedRows: summary.updatedRows,
        deactivatedRows: summary.deactivatedRows,
        invalidRows: summary.invalidRows,
        unmatchedCompanyRows: summary.unmatchedCompanyRows,
        startedAt,
        completedAt: new Date(),
        status: "completed",
      }).run();
      return summary;
    }, { behavior: "immediate" });
  } catch (error) {
    await db.insert(peopleImportSessions).values({
      id: sessionId,
      source: input.source,
      fileName: input.fileName,
      totalRows,
      invalidRows,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown import error",
      startedAt,
      completedAt: new Date(),
    });
    throw error;
  }
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export async function createManualPerson(input: ManualPersonInput) {
  const fullName = (input.fullName || `${input.firstName || ""} ${input.lastName || ""}`).trim();
  if (!fullName) {
    throw new Error("Full name is required");
  }

  const nameParts = splitFullName(fullName);
  const firstName = (input.firstName || nameParts.firstName || "").trim();
  const lastName = (input.lastName || nameParts.lastName || "").trim();
  const profileUrl = (input.profileUrl || "").trim();
  const profileUrlNormalized = normalizeLinkedInProfileUrl(profileUrl);
  const email = input.email?.trim() || null;
  const companyRaw = input.companyRaw?.trim() || null;
  const companyNormalized = normalizeCompanyName(companyRaw);
  const sourceRecordKey = email
    ? `email:${email.toLowerCase()}`
    : profileUrlNormalized
      ? `linkedin:${profileUrlNormalized}`
      : randomUUID();
  const identityKey = `manual:${sourceRecordKey}`;

  const now = new Date();
  const [existing] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.identityKey, identityKey))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(people)
      .set({
        firstName,
        lastName,
        fullName,
        profileUrl,
        profileUrlNormalized: profileUrlNormalized || "",
        email,
        companyRaw,
        companyNormalized,
        position: input.position?.trim() || null,
        notes: input.notes?.trim() || null,
        mappedCompanyId: input.mappedCompanyId ?? null,
        isActive: true,
        updatedAt: now,
        lastSeenAt: now,
      })
      .where(eq(people.id, existing.id))
      .returning();

    return updated;
  }

  const [created] = await db
    .insert(people)
    .values({
      source: "manual",
      sourceRecordKey,
      identityKey,
      firstName: firstName || fullName,
      lastName,
      fullName,
      profileUrl,
      profileUrlNormalized: profileUrlNormalized || "",
      email,
      companyRaw,
      companyNormalized,
      position: input.position?.trim() || null,
      connectedOn: null,
      mappedCompanyId: input.mappedCompanyId ?? null,
      notes: input.notes?.trim() || null,
      isStarred: false,
      isActive: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
}

export async function deleteAllPeople(): Promise<{ deletedCount: number }> {
  const [{ count }] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(people);

  await db.delete(people);

  return { deletedCount: Number(count) };
}
