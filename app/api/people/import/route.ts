import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError, ValidationError } from "@/lib/api";
import type { ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
import { importPeopleCsv } from "@/lib/people/sync";
import { MAX_CSV_FILE_SIZE } from "@/lib/constants";
import type { ImportMode } from "@/lib/people/types";

const SourceSchema = z.enum(["linkedin", "apollo"]);
const ImportModeSchema = z.enum(["merge", "replace"]);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const source = SourceSchema.parse(formData.get("source") ?? "linkedin");
    const importModeRaw = formData.get("importMode");
    const importMode: ImportMode = importModeRaw
      ? ImportModeSchema.parse(importModeRaw)
      : "merge";
    const mappingRaw = formData.get("mapping");
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
    let mapping: ApolloColumnMapping | undefined;
    if (source === "apollo") {
      if (typeof mappingRaw !== "string" || !mappingRaw.trim()) {
        throw new ValidationError("Apollo import requires mapping");
      }
      mapping = JSON.parse(mappingRaw) as ApolloColumnMapping;
    }

    const result = await importPeopleCsv({
      source,
      content,
      fileName: file.name,
      mapping,
      importMode,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
