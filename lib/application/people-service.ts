import { count, desc, eq } from "drizzle-orm";
import type { z } from "zod";

import { NotFoundError, ValidationError } from "@/lib/api";
import {
  apolloMappingSchema,
  peopleImportModeSchema,
  peopleSourceSchema,
  type manualPersonBodySchema,
  type peopleListQuerySchema,
  type personPatchBodySchema,
  type unmatchedCompaniesQuerySchema,
  type unmatchedCompanyPatchBodySchema,
  type unmatchedCompanyPeopleQuerySchema,
} from "@/lib/api/contracts/people";
import { MAX_CSV_FILE_SIZE } from "@/lib/constants";
import { db } from "@/lib/db";
import { companies, people, peopleImportSessions } from "@/lib/db/schema";
import { parsePeopleCsvRows } from "@/lib/people/csv";
import { suggestApolloMapping, type ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
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

async function assertMappedCompanyExists(companyId: number | null | undefined) {
  if (typeof companyId !== "number") return;
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new ValidationError("mappedCompanyId not found");
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
  return createManualPerson({
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
}

export async function updatePerson(id: number, input: PersonPatchInput) {
  await assertMappedCompanyExists(input.mappedCompanyId);
  const [updated] = await db.update(people).set({ ...input, updatedAt: new Date() }).where(eq(people.id, id)).returning();
  if (!updated) throw new NotFoundError("Person not found", "person_not_found");
  return updated;
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
