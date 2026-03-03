export interface CsvParseResult {
  rows: string[][];
}

export function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCsv(content: string): CsvParseResult {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentValue += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentValue += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    currentValue += char;
  }

  currentRow.push(currentValue);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }

  return { rows };
}

export function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

export function getCell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] || "").trim();
}
