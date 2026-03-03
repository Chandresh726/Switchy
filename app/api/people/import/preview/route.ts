import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError, ValidationError } from "@/lib/api";
import { suggestApolloMapping } from "@/lib/people/import/parsers/apollo";
import { parsePeopleCsvRows } from "@/lib/people/csv";
import { MAX_CSV_FILE_SIZE } from "@/lib/constants";

const SourceSchema = z.enum(["linkedin", "apollo"]);

function toSampleRows(rows: string[][], limit = 5): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1, limit + 1).map((row) => {
    const sample: Record<string, string> = {};
    headers.forEach((header, index) => {
      sample[header] = row[index] || "";
    });
    return sample;
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const source = SourceSchema.parse(formData.get("source") ?? "linkedin");
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("file is required");
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      throw new ValidationError("Only CSV files are supported");
    }

    if (file.size > MAX_CSV_FILE_SIZE) {
      throw new ValidationError("File too large. Maximum size is 10MB.");
    }

    const content = await file.text();
    const rows = parsePeopleCsvRows(content);
    if (rows.length === 0) {
      throw new ValidationError("CSV is empty");
    }

    const headers = rows[0];
    const suggestedMapping = source === "apollo"
      ? suggestApolloMapping(headers)
      : {};

    return NextResponse.json({
      source,
      detectedHeaders: headers,
      suggestedMapping,
      sampleRows: toSampleRows(rows),
      totalRows: Math.max(0, rows.length - 1),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
