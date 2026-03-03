import { normalizeCompanyName, normalizeLinkedInProfileUrl } from "@/lib/people/normalize";
import type { ParsedPeopleImport, PersonImportRow } from "@/lib/people/types";

import { getCell, normalizeHeader, parseCsv } from "./csv-utils";

export const APOLLO_FIELD_ALIASES: Record<string, string[]> = {
  firstName: ["first name", "firstname"],
  lastName: ["last name", "lastname"],
  fullName: ["name", "full name", "contact name", "person name"],
  email: ["email", "email address", "work email", "personal email"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile", "person linkedin url"],
  company: ["company", "organization", "account name", "current company", "account"],
  position: ["title", "job title", "position", "headline"],
  notes: ["notes", "description"],
};

export interface ApolloColumnMapping {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  company?: string | null;
  position?: string | null;
  notes?: string | null;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function headerIndexMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i += 1) {
    map.set(normalizeHeader(headers[i]), i);
  }
  return map;
}

export function suggestApolloMapping(headers: string[]): ApolloColumnMapping {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const mapping: ApolloColumnMapping = {};

  for (const [field, aliases] of Object.entries(APOLLO_FIELD_ALIASES)) {
    const matchedAlias = aliases.find((alias) => normalizedHeaders.includes(normalizeHeader(alias)));
    if (!matchedAlias) {
      mapping[field as keyof ApolloColumnMapping] = null;
      continue;
    }

    const index = normalizedHeaders.findIndex((header) => header === normalizeHeader(matchedAlias));
    mapping[field as keyof ApolloColumnMapping] = index >= 0 ? headers[index] : null;
  }

  return mapping;
}

function buildSourceRecordKey(params: {
  email: string | null;
  linkedinUrlNormalized: string | null;
}): string | null {
  if (params.email) {
    return `email:${params.email.toLowerCase()}`;
  }
  if (params.linkedinUrlNormalized) {
    return `linkedin:${params.linkedinUrlNormalized}`;
  }

  return null;
}

function resolveColumnIndex(
  headersByNormalized: Map<string, number>,
  columnName: string | null | undefined
): number | undefined {
  if (!columnName) return undefined;
  return headersByNormalized.get(normalizeHeader(columnName));
}

export function parseApolloCsv(content: string, mapping: ApolloColumnMapping): ParsedPeopleImport {
  const parsed = parseCsv(content);
  if (parsed.rows.length === 0) {
    throw new Error("CSV is empty");
  }

  const headers = parsed.rows[0];
  const normalizedHeaderMap = headerIndexMap(headers);
  const dataRows = parsed.rows.slice(1);

  const indexes = {
    firstName: resolveColumnIndex(normalizedHeaderMap, mapping.firstName),
    lastName: resolveColumnIndex(normalizedHeaderMap, mapping.lastName),
    fullName: resolveColumnIndex(normalizedHeaderMap, mapping.fullName),
    email: resolveColumnIndex(normalizedHeaderMap, mapping.email),
    linkedinUrl: resolveColumnIndex(normalizedHeaderMap, mapping.linkedinUrl),
    company: resolveColumnIndex(normalizedHeaderMap, mapping.company),
    position: resolveColumnIndex(normalizedHeaderMap, mapping.position),
    notes: resolveColumnIndex(normalizedHeaderMap, mapping.notes),
  };

  const rows: PersonImportRow[] = [];
  const errors: ParsedPeopleImport["errors"] = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const rowNumber = index + 2;
    const row = dataRows[index];
    if (row.every((cell) => !cell || cell.trim() === "")) {
      continue;
    }

    const fullNameFromRow = getCell(row, indexes.fullName);
    const split = splitName(fullNameFromRow);
    const firstName = getCell(row, indexes.firstName) || split.firstName;
    const lastName = getCell(row, indexes.lastName) || split.lastName;
    const fullName = `${firstName} ${lastName}`.trim() || fullNameFromRow.trim();
    const email = getCell(row, indexes.email) || null;
    const profileUrl = getCell(row, indexes.linkedinUrl);
    const profileUrlNormalized = normalizeLinkedInProfileUrl(profileUrl);
    const companyRaw = getCell(row, indexes.company) || null;
    const companyNormalized = normalizeCompanyName(companyRaw);
    const position = getCell(row, indexes.position) || null;
    const sourceRecordKey = buildSourceRecordKey({
      email,
      linkedinUrlNormalized: profileUrlNormalized,
    });

    if (!fullName) {
      errors.push({ rowNumber, reason: "Missing name" });
      continue;
    }

    if (!sourceRecordKey) {
      errors.push({
        rowNumber,
        reason: "Need at least one identity field: email or LinkedIn URL.",
      });
      continue;
    }

    rows.push({
      rowNumber,
      source: "apollo",
      sourceRecordKey,
      identityKey: `apollo:${sourceRecordKey}`,
      firstName: firstName || fullName.split(" ")[0] || "Unknown",
      lastName: lastName || fullName.split(" ").slice(1).join(" "),
      fullName,
      profileUrl: profileUrl || "",
      profileUrlNormalized,
      email,
      companyRaw,
      companyNormalized,
      position,
      connectedOn: null,
      notes: getCell(row, indexes.notes) || null,
    });
  }

  return {
    rows,
    errors,
    totalRows: dataRows.length,
  };
}
