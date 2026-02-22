import { randomUUID } from "crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, connectionImportSessions, linkedinConnections } from "@/lib/db/schema";
import { parseConnectionsCsv } from "@/lib/connections/csv";
import { normalizeCompanyName } from "@/lib/connections/normalize";
import type { ConnectionImportSummary } from "@/lib/connections/types";

export async function importConnectionsCsv(content: string, fileName: string): Promise<ConnectionImportSummary> {
  const sessionId = randomUUID();
  const startedAt = new Date();

  await db.insert(connectionImportSessions).values({
    id: sessionId,
    fileName,
    status: "in_progress",
    startedAt,
  });

  try {
    const parsed = parseConnectionsCsv(content);
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

    const existingConnections = await db
      .select({
        id: linkedinConnections.id,
        identityKey: linkedinConnections.identityKey,
      })
      .from(linkedinConnections);

    const existingMap = new Map(existingConnections.map((item) => [item.identityKey, item.id]));
    const seenIdentityKeys = new Set<string>();

    let unmatchedCompanyRows = 0;

    const toInsert: (typeof linkedinConnections.$inferInsert)[] = [];
    const toUpdate: { id: number; data: Partial<typeof linkedinConnections.$inferSelect> }[] = [];

    for (const row of parsed.rows) {
      if (!row.identityKey) continue;

      seenIdentityKeys.add(row.identityKey);
      const mappedCompanyId = row.companyNormalized ? (companyMap.get(row.companyNormalized) ?? null) : null;
      if (row.companyNormalized && !mappedCompanyId) {
        unmatchedCompanyRows += 1;
      }

      const existingId = existingMap.get(row.identityKey);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          data: {
            firstName: row.firstName,
            lastName: row.lastName,
            fullName: row.fullName,
            profileUrl: row.profileUrl,
            profileUrlNormalized: row.profileUrlNormalized || "",
            email: row.email,
            companyRaw: row.companyRaw,
            companyNormalized: row.companyNormalized,
            position: row.position,
            connectedOn: row.connectedOn,
            mappedCompanyId,
            isActive: true,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
      } else {
        toInsert.push({
          identityKey: row.identityKey,
          firstName: row.firstName,
          lastName: row.lastName,
          fullName: row.fullName,
          profileUrl: row.profileUrl,
          profileUrlNormalized: row.profileUrlNormalized || "",
          email: row.email,
          companyRaw: row.companyRaw,
          companyNormalized: row.companyNormalized,
          position: row.position,
          connectedOn: row.connectedOn,
          mappedCompanyId,
          isStarred: false,
          isActive: true,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const BATCH_SIZE = 500;
    let insertedRows = 0;
    let updatedRows = 0;

    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      await db.insert(linkedinConnections).values(batch);
      insertedRows += batch.length;
    }

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      db.transaction((tx) => {
        for (const item of batch) {
          tx
            .update(linkedinConnections)
            .set(item.data)
            .where(eq(linkedinConnections.id, item.id))
            .run();
        }
      });
      updatedRows += batch.length;
    }

    const seenKeys = Array.from(seenIdentityKeys);
    
    if (seenKeys.length === 0) {
      throw new Error("CSV file contains no valid connection rows");
    }
    
    const toDeactivate = await db
      .select({
        id: linkedinConnections.id,
      })
      .from(linkedinConnections)
      .where(
        and(
          eq(linkedinConnections.isActive, true),
          notInArray(linkedinConnections.identityKey, seenKeys)
        )
      );

    if (toDeactivate.length > 0) {
      await db
        .update(linkedinConnections)
        .set({
          isActive: false,
          updatedAt: now,
        })
        .where(inArray(linkedinConnections.id, toDeactivate.map((row) => row.id)));
    }

    const summary: ConnectionImportSummary = {
      sessionId,
      fileName,
      totalRows: parsed.totalRows,
      insertedRows,
      updatedRows,
      deactivatedRows: toDeactivate.length,
      invalidRows: parsed.errors.length,
      unmatchedCompanyRows,
      errors: parsed.errors.slice(0, 100),
    };

    await db
      .update(connectionImportSessions)
      .set({
        totalRows: summary.totalRows,
        insertedRows: summary.insertedRows,
        updatedRows: summary.updatedRows,
        deactivatedRows: summary.deactivatedRows,
        invalidRows: summary.invalidRows,
        unmatchedCompanyRows: summary.unmatchedCompanyRows,
        completedAt: new Date(),
        status: "completed",
      })
      .where(eq(connectionImportSessions.id, sessionId));

    return summary;
  } catch (error) {
    await db
      .update(connectionImportSessions)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown import error",
        completedAt: new Date(),
      })
      .where(eq(connectionImportSessions.id, sessionId));
    throw error;
  }
}

export async function deleteAllConnections(): Promise<{ deletedCount: number }> {
  const [{ count }] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(linkedinConnections);

  await db.delete(linkedinConnections);

  return { deletedCount: Number(count) };
}
