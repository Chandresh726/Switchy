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

interface PersonCompany {
  id: number;
  name: string;
}

interface Person {
  id: number;
  source: PersonSource;
  sourceRecordKey: string | null;
  fullName: string;
  firstName: string;
  profileUrl: string;
  email: string | null;
  companyRaw: string | null;
  position: string | null;
  mappedCompanyId: number | null;
  isStarred: boolean;
  isActive: boolean;
  lastSeenAt: string;
  company: PersonCompany | null;
}

export interface PersonQueryResponse {
  people: Person[];
  totalCount: number;
  hasMore: boolean;
}

export interface PeopleImportSession {
  id: string;
  source: PersonSource;
  fileName: string;
  startedAt: string;
}

export interface PeopleImportPreviewResponse {
  source: Exclude<PersonSource, "manual">;
  detectedHeaders: string[];
  suggestedMapping: Record<string, string | null>;
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export interface ImportSummary {
  sessionId: string;
  source: PersonSource;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  deactivatedRows: number;
  invalidRows: number;
  unmatchedCompanyRows: number;
  errors: Array<{ rowNumber: number; reason: string }>;
}
