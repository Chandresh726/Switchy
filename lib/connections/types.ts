export interface ParsedConnectionRow {
  rowNumber: number;
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
  identityKey: string | null;
}

export interface ParseRowError {
  rowNumber: number;
  reason: string;
}

export interface ParsedConnectionsCsv {
  rows: ParsedConnectionRow[];
  errors: ParseRowError[];
  totalRows: number;
}

export interface ConnectionImportSummary {
  sessionId: string;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  deactivatedRows: number;
  invalidRows: number;
  unmatchedCompanyRows: number;
  errors: ParseRowError[];
}

export interface ConnectionCompany {
  id: number;
  name: string;
}

export interface Connection {
  id: number;
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
  company: ConnectionCompany | null;
}

export interface ConnectionQueryResponse {
  connections: Connection[];
  totalCount: number;
  hasMore: boolean;
}

export interface ImportSession {
  id: string;
  fileName: string;
  startedAt: string;
}

export interface ImportSummary {
  sessionId: string;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  deactivatedRows: number;
  invalidRows: number;
  unmatchedCompanyRows: number;
  errors: Array<{ rowNumber: number; reason: string }>;
}
