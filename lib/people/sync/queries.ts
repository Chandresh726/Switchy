import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, people } from "@/lib/db/schema";
import type { PersonSource } from "@/lib/people/types";

export interface PeopleListFilters {
  search?: string;
  companyId?: number;
  source?: PersonSource | "all";
  starred?: boolean;
  active?: boolean | "all";
  unmatched?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: "lastSeenAt" | "fullName" | "createdAt" | "isStarred";
  sortOrder?: "asc" | "desc";
}

export async function getPeopleList(filters: PeopleListFilters) {
  const {
    search,
    companyId,
    source = "all",
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
    conditions.push(eq(people.mappedCompanyId, companyId));
  }

  if (source !== "all") {
    conditions.push(eq(people.source, source));
  }

  if (typeof starred === "boolean") {
    conditions.push(eq(people.isStarred, starred));
  }

  if (active !== "all" && typeof active === "boolean") {
    conditions.push(eq(people.isActive, active));
  }

  if (typeof unmatched === "boolean") {
    if (unmatched) {
      conditions.push(sql`${people.mappedCompanyId} IS NULL`);
    } else {
      conditions.push(sql`${people.mappedCompanyId} IS NOT NULL`);
    }
  }

  if (search && search.trim()) {
    const pattern = `%${search.trim()}%`;
    conditions.push(
      sql`(
        ${people.fullName} LIKE ${pattern}
        OR ${people.companyRaw} LIKE ${pattern}
        OR ${people.position} LIKE ${pattern}
        OR ${people.email} LIKE ${pattern}
      )`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortColumn =
    sortBy === "fullName"
      ? people.fullName
      : sortBy === "createdAt"
        ? people.createdAt
        : sortBy === "isStarred"
          ? people.isStarred
          : people.lastSeenAt;

  const orderExpr = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

  const [{ value: totalCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(people)
    .where(whereClause);

  const rows = await db
    .select({
      person: people,
      company: {
        id: companies.id,
        name: companies.name,
      },
    })
    .from(people)
    .leftJoin(companies, eq(people.mappedCompanyId, companies.id))
    .where(whereClause)
    .orderBy(orderExpr, desc(people.id))
    .limit(limit)
    .offset(offset);

  return {
    people: rows.map((row) => ({
      id: row.person.id,
      source: row.person.source,
      sourceRecordKey: row.person.sourceRecordKey,
      identityKey: row.person.identityKey,
      firstName: row.person.firstName,
      lastName: row.person.lastName,
      fullName: row.person.fullName,
      profileUrl: row.person.profileUrl,
      profileUrlNormalized: row.person.profileUrlNormalized,
      email: row.person.email,
      companyRaw: row.person.companyRaw,
      companyNormalized: row.person.companyNormalized,
      position: row.person.position,
      mappedCompanyId: row.person.mappedCompanyId,
      isStarred: row.person.isStarred,
      isActive: row.person.isActive,
      lastSeenAt: row.person.lastSeenAt,
      createdAt: row.person.createdAt,
      updatedAt: row.person.updatedAt,
      company: row.company?.id ? row.company : null,
    })),
    totalCount: Number(totalCount ?? 0),
    hasMore: offset + limit < Number(totalCount ?? 0),
  };
}
