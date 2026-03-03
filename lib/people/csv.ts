import { parseCsv } from "@/lib/people/import/parsers/csv-utils";
import { parseLinkedinCsv } from "@/lib/people/import/parsers/linkedin";
import type { ParsedPeopleImport } from "@/lib/people/types";

export function parseConnectionsCsv(content: string): ParsedPeopleImport {
  return parseLinkedinCsv(content);
}

export function parsePeopleCsvRows(content: string): string[][] {
  return parseCsv(content).rows;
}
