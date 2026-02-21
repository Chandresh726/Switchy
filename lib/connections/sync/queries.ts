import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, linkedinConnections } from "@/lib/db/schema";

export interface ConnectionListFilters {
  search?: string;
  companyId?: number;
  starred?: boolean;
  active?: boolean | "all";
  unmatched?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "lastSeenAt" | "fullName" | "createdAt" | "isStarred";
  sortOrder?: "asc" | "desc";
}

export async function getConnectionsList(filters: ConnectionListFilters) {
  const {
    search,
    companyId,
    starred,
    active = true,
    unmatched,
    limit = 100,
    offset = 0,
    sortBy = "lastSeenAt",
    sortOrder = "desc",
  } = filters;

  const conditions = [];

  if (typeof companyId === "number") {
    conditions.push(eq(linkedinConnections.mappedCompanyId, companyId));
  }

  if (typeof starred === "boolean") {
    conditions.push(eq(linkedinConnections.isStarred, starred));
  }

  if (active !== "all" && typeof active === "boolean") {
    conditions.push(eq(linkedinConnections.isActive, active));
  }

  if (typeof unmatched === "boolean") {
    if (unmatched) {
      conditions.push(sql`${linkedinConnections.mappedCompanyId} IS NULL`);
    } else {
      conditions.push(sql`${linkedinConnections.mappedCompanyId} IS NOT NULL`);
    }
  }

  if (search && search.trim()) {
    const pattern = `%${search.trim()}%`;
    conditions.push(
      sql`(
        ${linkedinConnections.fullName} LIKE ${pattern}
        OR ${linkedinConnections.companyRaw} LIKE ${pattern}
        OR ${linkedinConnections.position} LIKE ${pattern}
        OR ${linkedinConnections.email} LIKE ${pattern}
      )`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortColumn =
    sortBy === "fullName"
      ? linkedinConnections.fullName
      : sortBy === "createdAt"
        ? linkedinConnections.createdAt
        : sortBy === "isStarred"
          ? linkedinConnections.isStarred
          : linkedinConnections.lastSeenAt;

  const orderExpr = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

  const [{ value: totalCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(linkedinConnections)
    .where(whereClause);

  const rows = await db
    .select({
      connection: linkedinConnections,
      company: {
        id: companies.id,
        name: companies.name,
      },
    })
    .from(linkedinConnections)
    .leftJoin(companies, eq(linkedinConnections.mappedCompanyId, companies.id))
    .where(whereClause)
    .orderBy(orderExpr, desc(linkedinConnections.id))
    .limit(limit)
    .offset(offset);

  return {
    connections: rows.map((row) => ({
      id: row.connection.id,
      identityKey: row.connection.identityKey,
      firstName: row.connection.firstName,
      lastName: row.connection.lastName,
      fullName: row.connection.fullName,
      profileUrl: row.connection.profileUrl,
      profileUrlNormalized: row.connection.profileUrlNormalized,
      email: row.connection.email,
      companyRaw: row.connection.companyRaw,
      companyNormalized: row.connection.companyNormalized,
      position: row.connection.position,
      mappedCompanyId: row.connection.mappedCompanyId,
      isStarred: row.connection.isStarred,
      isActive: row.connection.isActive,
      lastSeenAt: row.connection.lastSeenAt,
      createdAt: row.connection.createdAt,
      updatedAt: row.connection.updatedAt,
      company: row.company?.id ? row.company : null,
    })),
    totalCount,
    hasMore: offset + limit < totalCount,
  };
}
