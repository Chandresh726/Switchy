import { normalizeCompanyName, normalizeLinkedInProfileUrl, parseConnectedOn } from "@/lib/people/normalize";
import type { ParsedPeopleImport, PersonImportRow } from "@/lib/people/types";

import { findColumnIndex, getCell, normalizeHeader, parseCsv } from "./csv-utils";

const REQUIRED_COLUMNS: Record<string, string[]> = {
  firstName: ["first name", "firstname", "first"],
  lastName: ["last name", "lastname", "last"],
  profileUrl: ["profile url", "url", "linkedin profile url", "linkedin url"],
  company: ["company", "current company"],
  position: ["position", "title", "job title"],
  connectedOn: ["connected on", "connectedon", "connection date"],
};

const OPTIONAL_COLUMNS: Record<string, string[]> = {
  email: ["email", "email address"],
  notes: ["notes", "note"],
};

function findHeaderRowIndex(rows: string[][]): number {
  const requiredKeys = Object.keys(REQUIRED_COLUMNS);
  let bestIndex = -1;
  let bestMatchedCount = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const candidateHeaders = rows[rowIndex].map((header) => normalizeHeader(header));
    if (candidateHeaders.every((header) => header.length === 0)) {
      continue;
    }

    let matchedCount = 0;
    let hasFirstName = false;
    let hasLastName = false;

    for (const [key, aliases] of Object.entries(REQUIRED_COLUMNS)) {
      const hasMatch = findColumnIndex(candidateHeaders, aliases) !== -1;
      if (hasMatch) {
        matchedCount += 1;
      }
      if (key === "firstName") hasFirstName = hasMatch;
      if (key === "lastName") hasLastName = hasMatch;
    }

    if (!hasFirstName || !hasLastName) {
      continue;
    }

    if (matchedCount === requiredKeys.length) {
      return rowIndex;
    }

    if (matchedCount > bestMatchedCount) {
      bestMatchedCount = matchedCount;
      bestIndex = rowIndex;
    }
  }

  if (bestMatchedCount >= 4) {
    return bestIndex;
  }

  return -1;
}

function getRequiredColumnMap(headers: string[]): Record<string, number> {
  const columnMap: Record<string, number> = {};

  for (const [key, aliases] of Object.entries(REQUIRED_COLUMNS)) {
    const index = findColumnIndex(headers, aliases);
    if (index === -1) {
      throw new Error(`Missing required CSV column for "${key}"`);
    }
    columnMap[key] = index;
  }

  return columnMap;
}

function getOptionalColumnMap(headers: string[]): Record<string, number> {
  const columnMap: Record<string, number> = {};

  for (const [key, aliases] of Object.entries(OPTIONAL_COLUMNS)) {
    const index = findColumnIndex(headers, aliases);
    if (index !== -1) {
      columnMap[key] = index;
    }
  }

  return columnMap;
}

function buildSourceRecordKey(params: {
  profileUrlNormalized: string | null;
  fullName: string;
  companyNormalized: string | null;
  connectedOn: Date | null;
  rowNumber: number;
}): string | null {
  if (params.profileUrlNormalized) {
    return params.profileUrlNormalized;
  }

  const normalizedName = params.fullName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalizedName || !params.companyNormalized || !params.connectedOn) {
    return null;
  }

  const connectedOn = params.connectedOn.toISOString().slice(0, 10);
  return `${normalizedName}|${params.companyNormalized}|${connectedOn}|row:${params.rowNumber}`;
}

function mapRow(
  row: string[],
  rowNumber: number,
  requiredColumns: Record<string, number>,
  optionalColumns: Record<string, number>
): PersonImportRow {
  const firstName = getCell(row, requiredColumns.firstName);
  const lastName = getCell(row, requiredColumns.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  const profileUrl = getCell(row, requiredColumns.profileUrl);
  const profileUrlNormalized = normalizeLinkedInProfileUrl(profileUrl);
  const companyRaw = getCell(row, requiredColumns.company) || null;
  const companyNormalized = normalizeCompanyName(companyRaw);
  const connectedOn = parseConnectedOn(getCell(row, requiredColumns.connectedOn));
  const position = getCell(row, requiredColumns.position) || null;
  const sourceRecordKey = buildSourceRecordKey({
    profileUrlNormalized,
    fullName,
    companyNormalized,
    connectedOn,
    rowNumber,
  });

  return {
    rowNumber,
    source: "linkedin",
    sourceRecordKey: sourceRecordKey || `row:${rowNumber}`,
    identityKey: sourceRecordKey ? `linkedin:${sourceRecordKey}` : "",
    firstName,
    lastName,
    fullName,
    profileUrl,
    profileUrlNormalized,
    email: getCell(row, optionalColumns.email) || null,
    companyRaw,
    companyNormalized,
    position,
    connectedOn,
    notes: getCell(row, optionalColumns.notes) || null,
  };
}

export function parseLinkedinCsv(content: string): ParsedPeopleImport {
  const parsed = parseCsv(content);
  if (parsed.rows.length === 0) {
    throw new Error("CSV is empty");
  }

  const headerRowIndex = findHeaderRowIndex(parsed.rows);
  if (headerRowIndex === -1) {
    throw new Error("Could not find valid CSV header row");
  }

  const headers = parsed.rows[headerRowIndex].map((header) => normalizeHeader(header));
  const requiredColumns = getRequiredColumnMap(headers);
  const optionalColumns = getOptionalColumnMap(headers);
  const dataRows = parsed.rows.slice(headerRowIndex + 1);

  const rows: PersonImportRow[] = [];
  const errors: ParsedPeopleImport["errors"] = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const rowNumber = headerRowIndex + index + 2;
    const row = dataRows[index];

    if (row.every((cell) => !cell || cell.trim() === "")) {
      continue;
    }

    const mapped = mapRow(row, rowNumber, requiredColumns, optionalColumns);
    if (!mapped.firstName || !mapped.lastName) {
      errors.push({ rowNumber, reason: "Missing first/last name" });
      continue;
    }

    if (!mapped.identityKey) {
      errors.push({
        rowNumber,
        reason: "Unable to build identity key. Need valid LinkedIn URL or (name + company + connected date).",
      });
      continue;
    }

    rows.push(mapped);
  }

  return {
    rows,
    errors,
    totalRows: dataRows.length,
  };
}
