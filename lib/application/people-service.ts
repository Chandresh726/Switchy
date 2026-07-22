import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  sql,
} from "drizzle-orm";
import type { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/api";
import {
  apolloMappingSchema,
  peopleImportModeSchema,
  peopleSourceSchema,
  type manualPersonBodySchema,
  type peopleListQuerySchema,
  type companyAliasDeleteQuerySchema,
  type companyAliasPatchBodySchema,
  type companyAliasesQuerySchema,
  type peopleDuplicatesQuerySchema,
  type peopleImportSessionDetailQuerySchema,
  type personMergeBodySchema,
  type personPatchBodySchema,
  type unmatchedCompaniesQuerySchema,
  type unmatchedCompanyPatchBodySchema,
  type unmatchedCompanyPeopleQuerySchema,
} from "@/lib/api/contracts/people";
import { MAX_CSV_FILE_SIZE } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  companies,
  companyAliases,
  people,
  peopleImportIssues,
  peopleImportSessions,
  personSourceRecords,
} from "@/lib/db/schema";
import { parsePeopleCsvRows } from "@/lib/people/csv";
import { suggestApolloMapping, type ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
import { normalizeCompanyName } from "@/lib/people/normalize";
import { isRecruiterPosition } from "@/lib/people/position";
import { backfillPersonSourceRecords } from "@/lib/people/source-records";
import {
  createManualPerson,
  getIgnoredUnmatchedCompaniesList,
  getPeopleList,
  getUnmatchedCompaniesList,
  getUnmatchedCompaniesSummary,
  getUnmatchedCompanyPersons,
  importPeopleCsv,
  mapUnmatchedCompanyGroup,
  refreshUnmatchedCompanyMappings,
  setUnmatchedCompanyIgnored,
} from "@/lib/people/sync";

type PeopleListQuery = z.infer<typeof peopleListQuerySchema>;
type ManualPersonInput = z.infer<typeof manualPersonBodySchema>;
type PersonPatchInput = z.infer<typeof personPatchBodySchema>;
type UnmatchedCompaniesQuery = z.infer<typeof unmatchedCompaniesQuerySchema>;
type UnmatchedCompanyPeopleQuery = z.infer<typeof unmatchedCompanyPeopleQuerySchema>;
type UnmatchedCompanyCommand = z.infer<typeof unmatchedCompanyPatchBodySchema>;
type PeopleImportSessionDetailQuery = z.infer<typeof peopleImportSessionDetailQuerySchema>;
type PeopleDuplicatesQuery = z.infer<typeof peopleDuplicatesQuerySchema>;
type PersonMergeInput = z.infer<typeof personMergeBodySchema>;
type CompanyAliasesQuery = z.infer<typeof companyAliasesQuerySchema>;
type CompanyAliasPatchInput = z.infer<typeof companyAliasPatchBodySchema>;
type CompanyAliasDeleteQuery = z.infer<typeof companyAliasDeleteQuerySchema>;

async function assertMappedCompanyExists(companyId: number | null | undefined) {
  if (typeof companyId !== "number") return;
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new ValidationError("mappedCompanyId not found");
}

async function withMappedCompany<T extends { mappedCompanyId?: number | null; position?: string | null }>(person: T) {
  const isRecruiter = isRecruiterPosition(person.position);
  if (!person.mappedCompanyId) return { ...person, isRecruiter, company: null };
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, person.mappedCompanyId))
    .limit(1);
  return { ...person, isRecruiter, company: company ?? null };
}

export function listPeople(query: PeopleListQuery) {
  return getPeopleList({
    search: query.search,
    companyId: query.companyId,
    source: query.source ?? "all",
    starred: query.starred ? query.starred === "true" : undefined,
    active: query.active === "all" ? "all" : query.active ? query.active === "true" : true,
    unmatched: query.unmatched ? query.unmatched === "true" : undefined,
    limit: query.limit,
    offset: query.offset,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });
}

export async function createPerson(input: ManualPersonInput) {
  await assertMappedCompanyExists(input.mappedCompanyId);
  const created = await createManualPerson({
    fullName: input.fullName,
    firstName: input.firstName,
    lastName: input.lastName,
    profileUrl: input.profileUrl,
    email: input.email || null,
    companyRaw: input.companyRaw,
    position: input.position,
    notes: input.notes,
    mappedCompanyId: input.mappedCompanyId ?? null,
  });
  return withMappedCompany(created);
}

export async function updatePerson(id: number, input: PersonPatchInput) {
  await assertMappedCompanyExists(input.mappedCompanyId);
  const [updated] = await db.update(people).set({ ...input, updatedAt: new Date() }).where(eq(people.id, id)).returning();
  if (!updated) throw new NotFoundError("Person not found", "person_not_found");
  return withMappedCompany(updated);
}

export async function getPersonDetail(id: number) {
  backfillPersonSourceRecords();
  const [person] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  if (!person) throw new NotFoundError("Person not found", "person_not_found");
  const sources = await db.select().from(personSourceRecords)
    .where(eq(personSourceRecords.personId, id))
    .orderBy(asc(personSourceRecords.firstSeenAt), asc(personSourceRecords.id));
  return { ...await withMappedCompany(person), sources };
}

export async function archivePerson(id: number) {
  const [existing] = await db.select({ archivedAt: people.archivedAt })
    .from(people).where(eq(people.id, id)).limit(1);
  if (!existing) throw new NotFoundError("Person not found", "person_not_found");
  if (!existing.archivedAt) {
    await db.update(people).set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(people.id, id));
  }
  return getPersonDetail(id);
}

export async function restorePerson(id: number) {
  const [updated] = await db.update(people).set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(people.id, id)).returning({ id: people.id });
  if (!updated) throw new NotFoundError("Person not found", "person_not_found");
  return getPersonDetail(id);
}

export async function purgePerson(id: number) {
  const [deleted] = await db.delete(people).where(eq(people.id, id)).returning({ id: people.id });
  if (!deleted) throw new NotFoundError("Person not found", "person_not_found");
  return { deletedId: deleted.id };
}

export async function listPeopleDuplicates(query: PeopleDuplicatesQuery) {
  backfillPersonSourceRecords();
  const profileGroups = await db.select({
    identityValue: personSourceRecords.profileUrlNormalized,
    personCount: sql<number>`count(distinct ${personSourceRecords.personId})`.as("person_count"),
  }).from(personSourceRecords)
    .where(isNotNull(personSourceRecords.profileUrlNormalized))
    .groupBy(personSourceRecords.profileUrlNormalized)
    .having(sql`count(distinct ${personSourceRecords.personId}) > 1`);
  const emailGroups = await db.select({
    identityValue: personSourceRecords.emailNormalized,
    personCount: sql<number>`count(distinct ${personSourceRecords.personId})`.as("person_count"),
  }).from(personSourceRecords)
    .where(isNotNull(personSourceRecords.emailNormalized))
    .groupBy(personSourceRecords.emailNormalized)
    .having(sql`count(distinct ${personSourceRecords.personId}) > 1`);
  const duplicateGroups = [
    ...profileGroups.map((group) => ({ ...group, identityKind: "linkedin_url" as const })),
    ...emailGroups.map((group) => ({ ...group, identityKind: "email" as const })),
  ].filter((group): group is typeof group & { identityValue: string } => Boolean(group.identityValue))
    .sort((left, right) => (
      left.identityKind.localeCompare(right.identityKind)
      || left.identityValue.localeCompare(right.identityValue)
    ));
  const totalCount = duplicateGroups.length;
  const rows = duplicateGroups.slice(query.offset, query.offset + query.limit);
  const groups = await Promise.all(rows.map(async (row) => {
    const identityKind = row.identityKind;
    const identityColumn = identityKind === "linkedin_url"
      ? personSourceRecords.profileUrlNormalized
      : personSourceRecords.emailNormalized;
    const sourceRows = await db.select({ personId: personSourceRecords.personId })
      .from(personSourceRecords)
      .where(eq(identityColumn, row.identityValue));
    const personIds = [...new Set(sourceRows.map((source) => source.personId))];
    const duplicatePeople = await db.select().from(people).where(inArray(people.id, personIds));
    return {
      identityKind,
      identityValue: row.identityValue,
      matchReasons: [identityKind === "linkedin_url" ? "exact_linkedin_url" as const : "exact_email" as const],
      people: duplicatePeople,
    };
  }));
  return {
    groups,
    totalCount,
    hasMore: query.offset + groups.length < totalCount,
  };
}

function mergedNotes(targetName: string, targetNotes: string | null, duplicateName: string, duplicateNotes: string | null) {
  if (!duplicateNotes || duplicateNotes === targetNotes) return targetNotes;
  if (!targetNotes) return duplicateNotes;
  return `${targetNotes}\n\nMerged from ${duplicateName || targetName}:\n${duplicateNotes}`;
}

export async function mergePeople(id: number, input: PersonMergeInput) {
  if (id === input.duplicatePersonId) {
    throw new ValidationError("A person cannot be merged into itself");
  }
  backfillPersonSourceRecords();
  await db.transaction((tx) => {
    const [target, duplicate] = [id, input.duplicatePersonId].map((personId) => (
      tx.select().from(people).where(eq(people.id, personId)).limit(1).get()
    ));
    if (!target || !duplicate) throw new NotFoundError("Person not found", "person_not_found");
    const duplicateSources = tx.select().from(personSourceRecords)
      .where(eq(personSourceRecords.personId, duplicate.id)).all();
    for (const source of duplicateSources) {
      const conflict = tx.select({ id: personSourceRecords.id }).from(personSourceRecords)
        .where(and(
          eq(personSourceRecords.personId, target.id),
          eq(personSourceRecords.source, source.source),
          eq(personSourceRecords.sourceRecordKey, source.sourceRecordKey),
          ne(personSourceRecords.id, source.id)
        )).get();
      if (conflict) {
        throw new ConflictError("Source identity already belongs to the target person", "person_merge_conflict");
      }
    }
    tx.update(personSourceRecords).set({ personId: target.id, updatedAt: new Date() })
      .where(eq(personSourceRecords.personId, duplicate.id)).run();
    const activeSource = tx.select({ id: personSourceRecords.id }).from(personSourceRecords)
      .where(and(eq(personSourceRecords.personId, target.id), eq(personSourceRecords.isActive, true))).limit(1).get();
    tx.update(people).set({
      isStarred: target.isStarred || duplicate.isStarred,
      notes: mergedNotes(target.fullName, target.notes, duplicate.fullName, duplicate.notes),
      isActive: Boolean(activeSource),
      updatedAt: new Date(),
    }).where(eq(people.id, target.id)).run();
    tx.delete(people).where(eq(people.id, duplicate.id)).run();
  }, { behavior: "immediate" });
  return { person: await getPersonDetail(id), mergedPersonId: input.duplicatePersonId };
}

function sourceProjection(source: typeof personSourceRecords.$inferSelect) {
  return {
    identityKey: `${source.source}:${source.sourceRecordKey}`,
    source: source.source,
    sourceRecordKey: source.sourceRecordKey,
    firstName: source.firstName,
    lastName: source.lastName,
    fullName: source.fullName,
    profileUrl: source.profileUrl,
    profileUrlNormalized: source.profileUrlNormalized || "",
    email: source.email,
    companyRaw: source.companyRaw,
    companyNormalized: source.companyNormalized,
    position: source.position,
    connectedOn: source.connectedOn,
    isActive: source.isActive,
    lastSeenAt: source.lastSeenAt,
    updatedAt: new Date(),
  };
}

export async function splitPersonSource(id: number, sourceRecordId: number) {
  backfillPersonSourceRecords();
  const createdPersonId = await db.transaction((tx) => {
    const source = tx.select().from(personSourceRecords).where(and(
      eq(personSourceRecords.id, sourceRecordId),
      eq(personSourceRecords.personId, id)
    )).get();
    if (!source) throw new NotFoundError("Person source not found", "person_source_not_found");
    const remainingSources = tx.select().from(personSourceRecords)
      .where(and(eq(personSourceRecords.personId, id), ne(personSourceRecords.id, sourceRecordId)))
      .orderBy(asc(personSourceRecords.firstSeenAt), asc(personSourceRecords.id)).all();
    if (remainingSources.length === 0) {
      throw new ConflictError("The only source on a person cannot be split", "person_source_split_conflict");
    }
    const target = tx.select().from(people).where(eq(people.id, id)).get();
    if (!target) throw new NotFoundError("Person not found", "person_not_found");
    if (target.source === source.source && target.sourceRecordKey === source.sourceRecordKey) {
      tx.update(people).set(sourceProjection(remainingSources[0])).where(eq(people.id, id)).run();
    }
    const trackedCompanyId = source.companyNormalized
      ? tx.select({ id: companies.id, name: companies.name }).from(companies).all()
        .find((company) => normalizeCompanyName(company.name) === source.companyNormalized)?.id ?? null
      : null;
    const mappedCompanyId = trackedCompanyId ?? (source.companyNormalized
      ? tx.select({ id: companyAliases.mappedCompanyId }).from(companyAliases)
        .where(eq(companyAliases.companyNormalized, source.companyNormalized)).limit(1).get()?.id ?? null
      : null);
    const [created] = tx.insert(people).values({
      ...sourceProjection(source),
      mappedCompanyId,
      isStarred: false,
      notes: null,
      archivedAt: null,
      createdAt: new Date(),
    }).returning({ id: people.id }).all();
    tx.update(personSourceRecords).set({ personId: created.id, updatedAt: new Date() })
      .where(eq(personSourceRecords.id, sourceRecordId)).run();
    const targetActive = remainingSources.some((item) => item.isActive);
    tx.update(people).set({ isActive: targetActive, updatedAt: new Date() })
      .where(eq(people.id, id)).run();
    return created.id;
  }, { behavior: "immediate" });
  return {
    person: await getPersonDetail(id),
    createdPerson: await getPersonDetail(createdPersonId),
  };
}

export async function listPeopleImportSessions(limit: number, offset: number) {
  const [sessions, [{ value: total }]] = await Promise.all([
    db.select().from(peopleImportSessions)
      .orderBy(desc(peopleImportSessions.startedAt), desc(peopleImportSessions.id))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(peopleImportSessions),
  ]);
  return {
    sessions,
    pagination: { total, limit, offset, hasMore: offset + sessions.length < total },
  };
}

export async function getPeopleImportSession(id: string, query: PeopleImportSessionDetailQuery) {
  const [session] = await db.select().from(peopleImportSessions)
    .where(eq(peopleImportSessions.id, id)).limit(1);
  if (!session) throw new NotFoundError("People import session not found", "people_import_session_not_found");
  const [issues, [{ value: total }]] = await Promise.all([
    db.select().from(peopleImportIssues)
      .where(eq(peopleImportIssues.sessionId, id))
      .orderBy(asc(peopleImportIssues.rowNumber), asc(peopleImportIssues.id))
      .limit(query.issueLimit).offset(query.issueOffset),
    db.select({ value: count() }).from(peopleImportIssues)
      .where(eq(peopleImportIssues.sessionId, id)),
  ]);
  return {
    ...session,
    issues,
    issuePagination: {
      total,
      limit: query.issueLimit,
      offset: query.issueOffset,
      hasMore: query.issueOffset + issues.length < total,
    },
  };
}

async function getCompanyAliasResponse(id: number) {
  const [row] = await db.select({
    alias: companyAliases,
    mappedCompany: { id: companies.id, name: companies.name },
    affectedPeopleCount: sql<number>`count(${people.id})`,
  }).from(companyAliases)
    .innerJoin(companies, eq(companyAliases.mappedCompanyId, companies.id))
    .leftJoin(people, eq(people.companyNormalized, companyAliases.companyNormalized))
    .where(eq(companyAliases.id, id))
    .groupBy(companyAliases.id, companies.id)
    .limit(1);
  if (!row) throw new NotFoundError("Company alias not found", "company_alias_not_found");
  return { ...row.alias, mappedCompany: row.mappedCompany, affectedPeopleCount: Number(row.affectedPeopleCount) };
}

export async function listCompanyAliases(query: CompanyAliasesQuery) {
  const [rows, [{ value: totalCount }]] = await Promise.all([
    db.select({
      alias: companyAliases,
      mappedCompany: { id: companies.id, name: companies.name },
      affectedPeopleCount: sql<number>`count(${people.id})`,
    }).from(companyAliases)
      .innerJoin(companies, eq(companyAliases.mappedCompanyId, companies.id))
      .leftJoin(people, eq(people.companyNormalized, companyAliases.companyNormalized))
      .groupBy(companyAliases.id, companies.id)
      .orderBy(asc(companyAliases.companyNormalized), asc(companyAliases.id))
      .limit(query.limit).offset(query.offset),
    db.select({ value: count() }).from(companyAliases),
  ]);
  return {
    aliases: rows.map((row) => ({
      ...row.alias,
      mappedCompany: row.mappedCompany,
      affectedPeopleCount: Number(row.affectedPeopleCount),
    })),
    totalCount,
    hasMore: query.offset + rows.length < totalCount,
  };
}

export async function remapCompanyAlias(id: number, input: CompanyAliasPatchInput) {
  await assertMappedCompanyExists(input.mappedCompanyId);
  const existing = await getCompanyAliasResponse(id);
  const updatedPeopleCount = await db.transaction((tx) => {
    let count = 0;
    if (input.updateExistingPeople) {
      const result = tx.update(people).set({
        mappedCompanyId: input.mappedCompanyId,
        updatedAt: new Date(),
      }).where(and(
        eq(people.companyNormalized, existing.companyNormalized),
        eq(people.mappedCompanyId, existing.mappedCompanyId)
      )).run();
      count = result.changes;
    }
    tx.update(companyAliases).set({ mappedCompanyId: input.mappedCompanyId })
      .where(eq(companyAliases.id, id)).run();
    return count;
  }, { behavior: "immediate" });
  return { alias: await getCompanyAliasResponse(id), updatedPeopleCount };
}

export async function deleteCompanyAlias(id: number, query: CompanyAliasDeleteQuery) {
  const existing = await getCompanyAliasResponse(id);
  const updatedPeopleCount = await db.transaction((tx) => {
    let count = 0;
    if (query.existingPeople === "unmap") {
      const result = tx.update(people).set({ mappedCompanyId: null, updatedAt: new Date() })
        .where(and(
          eq(people.companyNormalized, existing.companyNormalized),
          eq(people.mappedCompanyId, existing.mappedCompanyId)
        )).run();
      count = result.changes;
    }
    tx.delete(companyAliases).where(eq(companyAliases.id, id)).run();
    return count;
  }, { behavior: "immediate" });
  return { alias: null, updatedPeopleCount };
}

export function listIgnoredUnmatchedCompanies(query: UnmatchedCompaniesQuery) {
  return getIgnoredUnmatchedCompaniesList({ search: query.search, limit: query.limit, offset: query.offset });
}

export async function listUnmatchedCompanies(query: UnmatchedCompaniesQuery) {
  if (query.summaryOnly === "true") {
    return { summary: await getUnmatchedCompaniesSummary({ search: query.search }), groups: [], totalCount: 0, hasMore: false };
  }
  return getUnmatchedCompaniesList({ search: query.search, limit: query.limit, offset: query.offset });
}

export function listUnmatchedCompanyPeople(query: UnmatchedCompanyPeopleQuery) {
  return getUnmatchedCompanyPersons(query);
}

export async function updateUnmatchedCompany(command: UnmatchedCompanyCommand) {
  if (command.action === "refresh") return refreshUnmatchedCompanyMappings();
  if (command.action === "map") {
    await assertMappedCompanyExists(command.mappedCompanyId);
    return mapUnmatchedCompanyGroup(command.companyNormalized, command.mappedCompanyId);
  }
  await setUnmatchedCompanyIgnored(command.companyNormalized, command.action === "ignore");
  return { success: true as const };
}

function validateCsvFile(file: FormDataEntryValue | null): asserts file is File {
  if (!(file instanceof File)) throw new ValidationError("file is required");
  if (!file.name.toLowerCase().endsWith(".csv")) throw new ValidationError("Only CSV files are supported");
  if (file.size > MAX_CSV_FILE_SIZE) throw new ValidationError("File too large. Maximum size is 10MB.");
}

export async function previewPeopleImport(formData: FormData) {
  const source = peopleSourceSchema.parse(formData.get("source") ?? "linkedin");
  const file = formData.get("file");
  validateCsvFile(file);
  const rows = parsePeopleCsvRows(await file.text());
  if (rows.length === 0) throw new ValidationError("CSV is empty");
  const headers = rows[0];
  const sampleRows = rows.slice(1, 6).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
  return {
    source,
    detectedHeaders: headers,
    suggestedMapping: source === "apollo" ? suggestApolloMapping(headers) : {},
    sampleRows,
    totalRows: Math.max(0, rows.length - 1),
  };
}

export async function importPeople(formData: FormData) {
  const source = peopleSourceSchema.parse(formData.get("source") ?? "linkedin");
  const importMode = peopleImportModeSchema.parse(formData.get("importMode") ?? "merge");
  const file = formData.get("file");
  validateCsvFile(file);
  let mapping: ApolloColumnMapping | undefined;
  const mappingRaw = formData.get("mapping");
  if (source === "apollo") {
    if (typeof mappingRaw !== "string" || !mappingRaw.trim()) throw new ValidationError("Apollo import requires mapping");
    mapping = apolloMappingSchema.parse(JSON.parse(mappingRaw)) as ApolloColumnMapping;
  }
  return importPeopleCsv({ source, content: await file.text(), fileName: file.name, mapping, importMode });
}
