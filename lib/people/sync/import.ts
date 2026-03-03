import { randomUUID } from "crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { parseApolloCsv, type ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
import { parseLinkedinCsv } from "@/lib/people/import/parsers/linkedin";
import { normalizeCompanyName, normalizeLinkedInProfileUrl } from "@/lib/people/normalize";
import type { PersonImportSummary, PersonSource } from "@/lib/people/types";
import { db } from "@/lib/db";
import { companies, people, peopleImportSessions } from "@/lib/db/schema";

type CsvImportSource = Exclude<PersonSource, "manual">;

export interface ImportPeopleCsvInput {
  source: CsvImportSource;
  content: string;
  fileName: string;
  mapping?: ApolloColumnMapping;
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

  await db.insert(peopleImportSessions).values({
    id: sessionId,
    source: input.source,
    fileName: input.fileName,
    status: "in_progress",
    startedAt,
  });

  try {
    const parsed = parseCsvBySource(input);
    const now = new Date();

    const trackedCompanies = await db
      .select({
        id: companies.id,
        name: companies.name,
      })
      .from(companies);

    const companyMap = new Map<string, number>();
    for (const company of trackedCompanies) {
      const normalized = normalizeCompanyName(company.name);
      if (normalized) {
        companyMap.set(normalized, company.id);
      }
    }

    const existingPeople = await db
      .select({
        id: people.id,
        identityKey: people.identityKey,
      })
      .from(people)
      .where(eq(people.source, input.source));

    const existingMap = new Map(existingPeople.map((item) => [item.identityKey, item.id]));
    const seenIdentityKeys = new Set<string>();

    let unmatchedCompanyRows = 0;
    const toInsert: (typeof people.$inferInsert)[] = [];
    const toUpdate: { id: number; data: Partial<typeof people.$inferSelect> }[] = [];

    for (const row of parsed.rows) {
      seenIdentityKeys.add(row.identityKey);
      const mappedCompanyId = row.companyNormalized ? (companyMap.get(row.companyNormalized) ?? null) : null;
      if (row.companyNormalized && !mappedCompanyId) {
        unmatchedCompanyRows += 1;
      }

      const existingId = existingMap.get(row.identityKey);
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
        mappedCompanyId,
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      } as const;

      if (existingId) {
        toUpdate.push({
          id: existingId,
          data: commonData,
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

    if (seenIdentityKeys.size === 0) {
      throw new Error("CSV file contains no valid people rows");
    }

    const BATCH_SIZE = 500;
    let insertedRows = 0;
    let updatedRows = 0;

    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      await db.insert(people).values(batch);
      insertedRows += batch.length;
    }

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      db.transaction((tx) => {
        for (const item of batch) {
          tx
            .update(people)
            .set(item.data)
            .where(eq(people.id, item.id))
            .run();
        }
      });
      updatedRows += batch.length;
    }

    const seenKeys = Array.from(seenIdentityKeys);
    const toDeactivate = await db
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.source, input.source),
          eq(people.isActive, true),
          notInArray(people.identityKey, seenKeys)
        )
      );

    if (toDeactivate.length > 0) {
      await db
        .update(people)
        .set({
          isActive: false,
          updatedAt: now,
        })
        .where(inArray(people.id, toDeactivate.map((row) => row.id)));
    }

    const summary: PersonImportSummary = {
      sessionId,
      source: input.source,
      fileName: input.fileName,
      totalRows: parsed.totalRows,
      insertedRows,
      updatedRows,
      deactivatedRows: toDeactivate.length,
      invalidRows: parsed.errors.length,
      unmatchedCompanyRows,
      errors: parsed.errors.slice(0, 100),
    };

    await db
      .update(peopleImportSessions)
      .set({
        source: summary.source,
        totalRows: summary.totalRows,
        insertedRows: summary.insertedRows,
        updatedRows: summary.updatedRows,
        deactivatedRows: summary.deactivatedRows,
        invalidRows: summary.invalidRows,
        unmatchedCompanyRows: summary.unmatchedCompanyRows,
        completedAt: new Date(),
        status: "completed",
      })
      .where(eq(peopleImportSessions.id, sessionId));

    return summary;
  } catch (error) {
    await db
      .update(peopleImportSessions)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown import error",
        completedAt: new Date(),
      })
      .where(eq(peopleImportSessions.id, sessionId));
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
