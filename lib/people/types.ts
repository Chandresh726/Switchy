export type PersonSource = "linkedin" | "apollo" | "manual";
export type ImportMode = "merge" | "replace";

interface ParseRowError {
  rowNumber: number;
  reason: string;
}

export interface PersonImportRow {
  rowNumber: number;
  source: PersonSource;
  sourceRecordKey: string;
  identityKey: string;
  firstName: string;
  lastName: string;
  fullName: string;
  profileUrl: string;
  profileUrlNormalized: string | null;
  email: string | null;
  companyRaw: string | null;
  companyNormalized: string | null;
  position: string | null;
  connectedOn: Date | null;
  notes: string | null;
}

export interface ParsedPeopleImport {
  rows: PersonImportRow[];
  errors: ParseRowError[];
  totalRows: number;
}

export interface PersonImportSummary {
  sessionId: string;
  source: PersonSource;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  deactivatedRows: number;
  invalidRows: number;
  unmatchedCompanyRows: number;
  errors: ParseRowError[];
}
