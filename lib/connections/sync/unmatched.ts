import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, linkedinConnections, settings } from "@/lib/db/schema";
import { normalizeCompanyName } from "@/lib/connections/normalize";

const IGNORED_UNMATCHED_COMPANIES_KEY = "connections_ignored_unmatched_companies";

export interface UnmatchedCompanyConnection {
  id: number;
  fullName: string;
  position: string | null;
  email: string | null;
  profileUrl: string;
  isStarred: boolean;
}

export interface UnmatchedCompanyGroup {
  companyNormalized: string;
  companyLabel: string;
  connectionCount: number;
  isIgnored: boolean;
}

export interface UnmatchedCompaniesSummary {
  unmatchedCompanyCount: number;
  unmatchedConnectionCount: number;
  ignoredCompanyCount: number;
}

export interface UnmatchedCompaniesResponse {
  summary: UnmatchedCompaniesSummary;
  groups: UnmatchedCompanyGroup[];
  totalCount: number;
  hasMore: boolean;
}

interface GetUnmatchedCompaniesOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

interface RefreshUnmatchedCompanyMappingsOptions {
  companyIds?: number[];
}

async function getIgnoredUnmatchedCompanies(): Promise<Set<string>> {
  const [record] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, IGNORED_UNMATCHED_COMPANIES_KEY))
    .limit(1);

  if (!record?.value) {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(record.value);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    const normalized = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeCompanyName(item))
      .filter((item): item is string => Boolean(item));

    return new Set(normalized);
  } catch {
    return new Set<string>();
  }
}

async function saveIgnoredUnmatchedCompanies(companiesToIgnore: Set<string>): Promise<void> {
  if (companiesToIgnore.size === 0) {
    await db.delete(settings).where(eq(settings.key, IGNORED_UNMATCHED_COMPANIES_KEY));
    return;
  }

  const value = JSON.stringify(Array.from(companiesToIgnore).sort());
  const [existing] = await db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, IGNORED_UNMATCHED_COMPANIES_KEY))
    .limit(1);

  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, IGNORED_UNMATCHED_COMPANIES_KEY));
    return;
  }

  await db.insert(settings).values({
    key: IGNORED_UNMATCHED_COMPANIES_KEY,
    value,
    updatedAt: new Date(),
  });
}

function buildUnmatchedConditions(options: {
  mode: "all" | "unmatched" | "ignored";
  ignoredCompanies: Set<string>;
  search?: string;
}) {
  const conditions = [
    eq(linkedinConnections.isActive, true),
    sql`${linkedinConnections.mappedCompanyId} IS NULL`,
    sql`${linkedinConnections.companyNormalized} IS NOT NULL`,
    sql`${linkedinConnections.companyNormalized} <> ''`,
  ];

  if (options.search && options.search.trim()) {
    const pattern = `%${options.search.trim()}%`;
    conditions.push(
      sql`(
        ${linkedinConnections.companyRaw} LIKE ${pattern}
        OR ${linkedinConnections.companyNormalized} LIKE ${pattern}
      )`
    );
  }

  if (options.mode === "ignored") {
    if (options.ignoredCompanies.size === 0) {
      conditions.push(sql`1 = 0`);
    } else {
      conditions.push(
        inArray(linkedinConnections.companyNormalized, Array.from(options.ignoredCompanies))
      );
    }
  } else if (options.mode === "unmatched" && options.ignoredCompanies.size > 0) {
    conditions.push(
      notInArray(linkedinConnections.companyNormalized, Array.from(options.ignoredCompanies))
    );
  }

  return conditions;
}

async function getIgnoredCompanyCount(): Promise<number> {
  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  if (ignoredCompanies.size === 0) {
    return 0;
  }

  const [result] = await db
    .select({
      value: sql<number>`count(distinct ${linkedinConnections.companyNormalized})`,
    })
    .from(linkedinConnections)
    .where(
      and(
        eq(linkedinConnections.isActive, true),
        sql`${linkedinConnections.mappedCompanyId} IS NULL`,
        sql`${linkedinConnections.companyNormalized} IS NOT NULL`,
        sql`${linkedinConnections.companyNormalized} <> ''`,
        inArray(linkedinConnections.companyNormalized, Array.from(ignoredCompanies))
      )
    );

  return Number(result?.value ?? 0);
}

export async function getUnmatchedCompaniesSummary(options: {
  includeIgnored?: boolean;
  search?: string;
} = {}): Promise<UnmatchedCompaniesSummary> {
  const includeIgnored = options.includeIgnored ?? false;
  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  const conditions = buildUnmatchedConditions({
    mode: includeIgnored ? "all" : "unmatched",
    ignoredCompanies,
    search: options.search,
  });
  const whereClause = and(...conditions);

  const groupedQuery = db
    .select({
      companyNormalized: linkedinConnections.companyNormalized,
    })
    .from(linkedinConnections)
    .where(whereClause)
    .groupBy(linkedinConnections.companyNormalized)
    .as("unmatched_company_groups_summary");

  const [{ value: unmatchedCompanyCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(groupedQuery);

  const [{ value: unmatchedConnectionCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(linkedinConnections)
    .where(whereClause);

  const ignoredCompanyCount = await getIgnoredCompanyCount();

  return {
    unmatchedCompanyCount: Number(unmatchedCompanyCount ?? 0),
    unmatchedConnectionCount: Number(unmatchedConnectionCount ?? 0),
    ignoredCompanyCount,
  };
}

export async function getUnmatchedCompaniesList(
  options: GetUnmatchedCompaniesOptions = {}
): Promise<UnmatchedCompaniesResponse> {
  const search = options.search;
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  const conditions = buildUnmatchedConditions({
    mode: "unmatched",
    ignoredCompanies,
    search,
  });
  const whereClause = and(...conditions);

  const groupedQuery = db
    .select({
      companyNormalized: linkedinConnections.companyNormalized,
      companyLabel: sql<string>`coalesce(max(${linkedinConnections.companyRaw}), ${linkedinConnections.companyNormalized})`.as(
        "company_label"
      ),
      connectionCount: sql<number>`count(*)`.as("connection_count"),
    })
    .from(linkedinConnections)
    .where(whereClause)
    .groupBy(linkedinConnections.companyNormalized)
    .as("unmatched_company_groups");

  const [{ value: totalCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(groupedQuery);

  const groupedRows = await db
    .select({
      companyNormalized: groupedQuery.companyNormalized,
      companyLabel: groupedQuery.companyLabel,
      connectionCount: groupedQuery.connectionCount,
    })
    .from(groupedQuery)
    .orderBy(desc(groupedQuery.connectionCount), asc(groupedQuery.companyLabel))
    .limit(limit)
    .offset(offset);

  const summary = await getUnmatchedCompaniesSummary({
    search,
  });

  const groups = groupedRows.map((row) => ({
    companyNormalized: row.companyNormalized || "",
    companyLabel: row.companyLabel || row.companyNormalized || "Unknown company",
    connectionCount: Number(row.connectionCount || 0),
    isIgnored: row.companyNormalized ? ignoredCompanies.has(row.companyNormalized) : false,
  }));

  return {
    summary,
    groups,
    totalCount: Number(totalCount ?? 0),
    hasMore: offset + limit < Number(totalCount ?? 0),
  };
}

export async function getIgnoredUnmatchedCompaniesList(
  options: GetUnmatchedCompaniesOptions = {}
): Promise<UnmatchedCompaniesResponse> {
  const search = options.search;
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  const conditions = buildUnmatchedConditions({
    mode: "ignored",
    ignoredCompanies,
    search,
  });
  const whereClause = and(...conditions);

  const groupedQuery = db
    .select({
      companyNormalized: linkedinConnections.companyNormalized,
      companyLabel: sql<string>`coalesce(max(${linkedinConnections.companyRaw}), ${linkedinConnections.companyNormalized})`.as(
        "company_label"
      ),
      connectionCount: sql<number>`count(*)`.as("connection_count"),
    })
    .from(linkedinConnections)
    .where(whereClause)
    .groupBy(linkedinConnections.companyNormalized)
    .as("ignored_unmatched_company_groups");

  const [{ value: totalCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(groupedQuery);

  const groupedRows = await db
    .select({
      companyNormalized: groupedQuery.companyNormalized,
      companyLabel: groupedQuery.companyLabel,
      connectionCount: groupedQuery.connectionCount,
    })
    .from(groupedQuery)
    .orderBy(desc(groupedQuery.connectionCount), asc(groupedQuery.companyLabel))
    .limit(limit)
    .offset(offset);

  const summary = await getUnmatchedCompaniesSummary({
    search,
  });

  const groups = groupedRows.map((row) => ({
    companyNormalized: row.companyNormalized || "",
    companyLabel: row.companyLabel || row.companyNormalized || "Unknown company",
    connectionCount: Number(row.connectionCount || 0),
    isIgnored: true,
  }));

  return {
    summary,
    groups,
    totalCount: Number(totalCount ?? 0),
    hasMore: offset + limit < Number(totalCount ?? 0),
  };
}

export async function getUnmatchedCompanyConnections(options: {
  companyNormalized: string;
  limit?: number;
  offset?: number;
}): Promise<{
  connections: UnmatchedCompanyConnection[];
  totalCount: number;
  hasMore: boolean;
}> {
  const normalizedCompany = normalizeCompanyName(options.companyNormalized);
  if (!normalizedCompany) {
    return {
      connections: [],
      totalCount: 0,
      hasMore: false,
    };
  }

  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const whereClause = and(
    eq(linkedinConnections.isActive, true),
    sql`${linkedinConnections.mappedCompanyId} IS NULL`,
    eq(linkedinConnections.companyNormalized, normalizedCompany)
  );

  const [{ value: totalCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(linkedinConnections)
    .where(whereClause);

  const rows = await db
    .select({
      id: linkedinConnections.id,
      fullName: linkedinConnections.fullName,
      position: linkedinConnections.position,
      email: linkedinConnections.email,
      profileUrl: linkedinConnections.profileUrl,
      isStarred: linkedinConnections.isStarred,
    })
    .from(linkedinConnections)
    .where(whereClause)
    .orderBy(desc(linkedinConnections.isStarred), asc(linkedinConnections.fullName))
    .limit(limit)
    .offset(offset);

  return {
    connections: rows,
    totalCount: Number(totalCount ?? 0),
    hasMore: offset + limit < Number(totalCount ?? 0),
  };
}

export async function mapUnmatchedCompanyGroup(
  companyNameOrNormalized: string,
  mappedCompanyId: number
): Promise<{ updatedCount: number }> {
  const companyNormalized = normalizeCompanyName(companyNameOrNormalized);
  if (!companyNormalized) {
    return { updatedCount: 0 };
  }

  const updated = await db
    .update(linkedinConnections)
    .set({
      mappedCompanyId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(linkedinConnections.companyNormalized, companyNormalized),
        sql`${linkedinConnections.mappedCompanyId} IS NULL`
      )
    )
    .returning({ id: linkedinConnections.id });

  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  if (ignoredCompanies.has(companyNormalized)) {
    ignoredCompanies.delete(companyNormalized);
    await saveIgnoredUnmatchedCompanies(ignoredCompanies);
  }

  return { updatedCount: updated.length };
}

export async function refreshUnmatchedCompanyMappings(
  options: RefreshUnmatchedCompanyMappingsOptions = {}
): Promise<{ mappedConnectionCount: number; mappedCompanyCount: number }> {
  const normalizedCompanyIds = Array.from(
    new Set(
      (options.companyIds ?? []).filter(
        (id): id is number => Number.isInteger(id) && id > 0
      )
    )
  );

  const trackedCompanies = normalizedCompanyIds.length > 0
    ? await db
      .select({
        id: companies.id,
        name: companies.name,
      })
      .from(companies)
      .where(inArray(companies.id, normalizedCompanyIds))
    : await db
      .select({
        id: companies.id,
        name: companies.name,
      })
      .from(companies);

  const companyNameMap = new Map<string, number>();
  for (const company of trackedCompanies) {
    const companyNormalized = normalizeCompanyName(company.name);
    if (companyNormalized) {
      companyNameMap.set(companyNormalized, company.id);
    }
  }

  if (companyNameMap.size === 0) {
    return {
      mappedConnectionCount: 0,
      mappedCompanyCount: 0,
    };
  }

  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  let ignoredCompaniesChanged = false;
  let mappedConnectionCount = 0;
  let mappedCompanyCount = 0;

  for (const [companyNormalized, mappedCompanyId] of companyNameMap) {
    const updated = await db
      .update(linkedinConnections)
      .set({
        mappedCompanyId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(linkedinConnections.companyNormalized, companyNormalized),
          sql`${linkedinConnections.mappedCompanyId} IS NULL`
        )
      )
      .returning({ id: linkedinConnections.id });

    if (updated.length === 0) {
      continue;
    }

    mappedConnectionCount += updated.length;
    mappedCompanyCount += 1;

    if (ignoredCompanies.delete(companyNormalized)) {
      ignoredCompaniesChanged = true;
    }
  }

  if (ignoredCompaniesChanged) {
    await saveIgnoredUnmatchedCompanies(ignoredCompanies);
  }

  return {
    mappedConnectionCount,
    mappedCompanyCount,
  };
}

export async function setUnmatchedCompanyIgnored(
  companyNameOrNormalized: string,
  ignored: boolean
): Promise<void> {
  const companyNormalized = normalizeCompanyName(companyNameOrNormalized);
  if (!companyNormalized) {
    return;
  }

  const ignoredCompanies = await getIgnoredUnmatchedCompanies();
  if (ignored) {
    ignoredCompanies.add(companyNormalized);
  } else {
    ignoredCompanies.delete(companyNormalized);
  }

  await saveIgnoredUnmatchedCompanies(ignoredCompanies);
}
