import { randomUUID } from "crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { parseApolloCsv, type ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
import { parseLinkedinCsv } from "@/lib/people/import/parsers/linkedin";
import { normalizeCompanyName, normalizeLinkedInProfileUrl } from "@/lib/people/normalize";
import type { PersonImportSummary, PersonSource, ImportMode } from "@/lib/people/types";
import { db } from "@/lib/db";
import {
  companies,
  companyAliases,
  people,
  peopleImportIssues,
  peopleImportSessions,
  personSourceRecords,
} from "@/lib/db/schema";
import {
  getStableSourceIdentity,
  normalizePersonEmail,
} from "@/lib/people/source-records";

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
  const importMode = input.importMode ?? "merge";
  let totalRows = 0;
  let invalidRows = 0;
  let importIssues: Array<{
    rowNumber: number;
    kind: "invalid" | "duplicate" | "ambiguous_identity";
    reason: string;
    sourceRecordKey?: string;
  }> = [];

  try {
    const parsed = parseCsvBySource(input);
    totalRows = parsed.totalRows;
    invalidRows = parsed.errors.length;
    importIssues = parsed.errors.map((error) => ({ ...error, kind: "invalid" as const }));
    const seenRows = new Set<string>();
    const rows = parsed.rows.filter((row) => {
      if (!seenRows.has(row.sourceRecordKey)) {
        seenRows.add(row.sourceRecordKey);
        return true;
      }
      importIssues.push({
        rowNumber: row.rowNumber,
        kind: "duplicate",
        reason: "Duplicate source identity in CSV; the first valid row was used.",
        sourceRecordKey: row.sourceRecordKey,
      });
      return false;
    });
    if (rows.length === 0) {
      throw new Error("CSV file contains no valid people rows");
    }
    return db.transaction((tx) => {
      const now = new Date();
      tx.insert(peopleImportSessions).values({
        id: sessionId,
        source: input.source,
        fileName: input.fileName,
        importMode,
        totalRows: parsed.totalRows,
        invalidRows: parsed.errors.length,
        duplicateRows: importIssues.filter((issue) => issue.kind === "duplicate").length,
        startedAt,
        status: "in_progress",
      }).run();
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

      const existingRows = tx.select({
        sourceRecord: personSourceRecords,
        person: people,
      }).from(personSourceRecords)
        .innerJoin(people, eq(personSourceRecords.personId, people.id))
        .where(eq(personSourceRecords.source, input.source)).all();
      const existingMap = new Map(existingRows.map((item) => [item.sourceRecord.sourceRecordKey, item]));
      const existingStableIdentities = new Map<string, typeof existingRows>();
      for (const item of existingRows) {
        const stableIdentityKey = item.sourceRecord.stableIdentityKey;
        if (!stableIdentityKey) continue;
        const matches = existingStableIdentities.get(stableIdentityKey) ?? [];
        matches.push(item);
        existingStableIdentities.set(stableIdentityKey, matches);
      }
      const seenSourceRecordKeys = new Set<string>();
      const affectedPersonIds = new Set<number>();
      let insertedRows = 0;
      let updatedRows = 0;
      let unchangedRows = 0;
      let reactivatedRows = 0;
      let unmatchedCompanyRows = 0;

      for (const row of rows) {
        seenSourceRecordKeys.add(row.sourceRecordKey);
        const csvMappedCompanyId = row.companyNormalized
          ? (companyMap.get(row.companyNormalized) ?? null)
          : null;
        if (row.companyNormalized && !csvMappedCompanyId) unmatchedCompanyRows += 1;
        const existing = existingMap.get(row.sourceRecordKey);
        const identity = getStableSourceIdentity({
          source: row.source,
          sourceRecordKey: row.sourceRecordKey,
          profileUrlNormalized: row.profileUrlNormalized,
          email: row.email,
        });
        if (!existing && identity.identityKind === "composite" && identity.stableIdentityKey) {
          const legacyMatches = existingStableIdentities.get(identity.stableIdentityKey) ?? [];
          if (legacyMatches.some((item) => item.sourceRecord.sourceRecordKey !== row.sourceRecordKey)) {
            importIssues.push({
              rowNumber: row.rowNumber,
              kind: "ambiguous_identity",
              reason: "A legacy LinkedIn source has the same stable fallback identity; no existing person was reassigned.",
              sourceRecordKey: row.sourceRecordKey,
            });
          }
        }
        const sourceData = {
          ...identity,
          firstName: row.firstName,
          lastName: row.lastName,
          fullName: row.fullName,
          profileUrl: row.profileUrl || "",
          profileUrlNormalized: row.profileUrlNormalized,
          email: row.email,
          emailNormalized: normalizePersonEmail(row.email),
          companyRaw: row.companyRaw,
          companyNormalized: row.companyNormalized,
          position: row.position,
          connectedOn: row.connectedOn,
          sourceNotes: row.notes,
          isActive: true,
          lastSeenAt: now,
          lastImportSessionId: sessionId,
          updatedAt: now,
        } as const;
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
          const wasInactive = !existing.sourceRecord.isActive;
          const sourceChanged = wasInactive || [
            [existing.sourceRecord.firstName, sourceData.firstName],
            [existing.sourceRecord.lastName, sourceData.lastName],
            [existing.sourceRecord.fullName, sourceData.fullName],
            [existing.sourceRecord.profileUrl, sourceData.profileUrl],
            [existing.sourceRecord.email, sourceData.email],
            [existing.sourceRecord.companyRaw, sourceData.companyRaw],
            [existing.sourceRecord.position, sourceData.position],
            [existing.sourceRecord.sourceNotes, sourceData.sourceNotes],
          ].some(([before, after]) => before !== after);
          tx.update(personSourceRecords).set(sourceData)
            .where(eq(personSourceRecords.id, existing.sourceRecord.id)).run();
          const isPrimarySource = existing.person.source === input.source
            && existing.person.sourceRecordKey === row.sourceRecordKey;
          tx.update(people).set({
            ...(isPrimarySource ? {
              ...commonData,
              mappedCompanyId: preserve
                ? (existing.person.mappedCompanyId ?? csvMappedCompanyId)
                : csvMappedCompanyId,
              email: preserve ? (existing.person.email ?? row.email) : row.email,
            } : { isActive: true, lastSeenAt: now, updatedAt: now }),
          }).where(eq(people.id, existing.person.id)).run();
          affectedPersonIds.add(existing.person.id);
          updatedRows += 1;
          if (!sourceChanged) unchangedRows += 1;
          if (wasInactive) reactivatedRows += 1;
        } else {
          const [created] = tx.insert(people).values({
            identityKey: row.identityKey,
            ...commonData,
            isStarred: false,
            createdAt: now,
          }).returning().all();
          tx.insert(personSourceRecords).values({
            personId: created.id,
            source: row.source,
            sourceRecordKey: row.sourceRecordKey,
            ...sourceData,
            firstSeenAt: now,
            createdAt: now,
          }).run();
          affectedPersonIds.add(created.id);
          insertedRows += 1;
        }
      }

      let deactivatedRows = 0;
      if (importMode === "replace") {
        const toDeactivate = tx.select({
          id: personSourceRecords.id,
          personId: personSourceRecords.personId,
        }).from(personSourceRecords).where(and(
          eq(personSourceRecords.source, input.source),
          eq(personSourceRecords.isActive, true),
          notInArray(personSourceRecords.sourceRecordKey, [...seenSourceRecordKeys])
        )).all();
        if (toDeactivate.length > 0) {
          tx.update(personSourceRecords).set({ isActive: false, updatedAt: now }).where(and(
            eq(personSourceRecords.source, input.source),
            eq(personSourceRecords.isActive, true),
            notInArray(personSourceRecords.sourceRecordKey, [...seenSourceRecordKeys])
          )).run();
          for (const item of toDeactivate) affectedPersonIds.add(item.personId);
          deactivatedRows = toDeactivate.length;
        }
      }

      if (affectedPersonIds.size > 0) {
        const ids = [...affectedPersonIds];
        tx.update(people).set({
          isActive: sql<boolean>`exists(
            select 1 from ${personSourceRecords}
            where ${personSourceRecords.personId} = ${people.id}
              and ${personSourceRecords.isActive} = 1
          )`,
          updatedAt: now,
        }).where(inArray(people.id, ids)).run();
      }

      const summary: PersonImportSummary = {
        sessionId,
        source: input.source,
        fileName: input.fileName,
        totalRows: parsed.totalRows,
        insertedRows,
        updatedRows,
        unchangedRows,
        reactivatedRows,
        duplicateRows: importIssues.filter((issue) => issue.kind === "duplicate").length,
        deactivatedRows,
        invalidRows: parsed.errors.length,
        unmatchedCompanyRows,
        errors: importIssues.slice(0, 100).map(({ rowNumber, reason }) => ({ rowNumber, reason })),
      };
      tx.update(peopleImportSessions).set({
        insertedRows: summary.insertedRows,
        updatedRows: summary.updatedRows,
        unchangedRows: summary.unchangedRows,
        reactivatedRows: summary.reactivatedRows,
        duplicateRows: summary.duplicateRows,
        deactivatedRows: summary.deactivatedRows,
        invalidRows: summary.invalidRows,
        unmatchedCompanyRows: summary.unmatchedCompanyRows,
        startedAt,
        completedAt: new Date(),
        status: "completed",
      }).where(eq(peopleImportSessions.id, sessionId)).run();
      if (importIssues.length > 0) {
        tx.insert(peopleImportIssues).values(importIssues.map((issue) => ({
          sessionId,
          rowNumber: issue.rowNumber,
          kind: issue.kind,
          reason: issue.reason,
          sourceRecordKey: issue.sourceRecordKey,
        }))).run();
      }
      return summary;
    }, { behavior: "immediate" });
  } catch (error) {
    await db.insert(peopleImportSessions).values({
      id: sessionId,
      source: input.source,
      fileName: input.fileName,
      totalRows,
      invalidRows,
      duplicateRows: importIssues.filter((issue) => issue.kind === "duplicate").length,
      status: "failed",
      importMode,
      errorMessage: error instanceof Error ? error.message : "Unknown import error",
      startedAt,
      completedAt: new Date(),
    });
    if (importIssues.length > 0) {
      await db.insert(peopleImportIssues).values(importIssues.map((issue) => ({
        sessionId,
        rowNumber: issue.rowNumber,
        kind: issue.kind,
        reason: issue.reason,
        sourceRecordKey: issue.sourceRecordKey,
      })));
    }
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
  return db.transaction((tx) => {
    const existingSource = tx.select({
      id: personSourceRecords.id,
      personId: personSourceRecords.personId,
    }).from(personSourceRecords).where(and(
      eq(personSourceRecords.source, "manual"),
      eq(personSourceRecords.sourceRecordKey, sourceRecordKey)
    )).limit(1).get();
    const existingPerson = existingSource
      ? tx.select().from(people).where(eq(people.id, existingSource.personId)).limit(1).get()
      : tx
        .select()
        .from(people)
        .where(eq(people.identityKey, identityKey))
        .limit(1)
        .get();
    const personData = {
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
      notes: input.notes?.trim() || null,
      mappedCompanyId: input.mappedCompanyId ?? null,
      isActive: true,
      updatedAt: now,
      lastSeenAt: now,
    } as const;
    const sourceData = {
      ...getStableSourceIdentity({
        source: "manual",
        sourceRecordKey,
        profileUrlNormalized,
        email,
      }),
      firstName: personData.firstName,
      lastName,
      fullName,
      profileUrl,
      profileUrlNormalized,
      email,
      emailNormalized: normalizePersonEmail(email),
      companyRaw,
      companyNormalized,
      position: personData.position,
      connectedOn: null,
      sourceNotes: personData.notes,
      isActive: true,
      lastSeenAt: now,
      updatedAt: now,
    } as const;

    if (existingPerson) {
      const isPrimarySource = existingPerson.source === "manual"
        && existingPerson.sourceRecordKey === sourceRecordKey;
      const [updated] = tx.update(people).set(isPrimarySource
        ? personData
        : { isActive: true, lastSeenAt: now, updatedAt: now })
        .where(eq(people.id, existingPerson.id)).returning().all();
      if (existingSource) {
        tx.update(personSourceRecords).set(sourceData)
          .where(eq(personSourceRecords.id, existingSource.id)).run();
      } else {
        tx.insert(personSourceRecords).values({
          personId: existingPerson.id,
          source: "manual",
          sourceRecordKey,
          ...sourceData,
          firstSeenAt: now,
          createdAt: now,
        }).run();
      }
      return updated;
    }

    const [created] = tx.insert(people).values({
      source: "manual",
      sourceRecordKey,
      identityKey,
      ...personData,
      isStarred: false,
      createdAt: now,
    }).returning().all();
    tx.insert(personSourceRecords).values({
      personId: created.id,
      source: "manual",
      sourceRecordKey,
      ...sourceData,
      firstSeenAt: now,
      createdAt: now,
    }).run();
    return created;
  }, { behavior: "immediate" });
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
