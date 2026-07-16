import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError, ValidationError } from "@/lib/api";
import {
  apolloMappingSchema,
  peopleImportModeSchema,
  peopleSourceSchema,
} from "@/lib/api/contracts/people";
import type { ApolloColumnMapping } from "@/lib/people/import/parsers/apollo";
import { importPeopleCsv } from "@/lib/people/sync";
import { MAX_CSV_FILE_SIZE } from "@/lib/constants";
import type { ImportMode } from "@/lib/people/types";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const formData = await request.formData();
    const source = peopleSourceSchema.parse(formData.get("source") ?? "linkedin");
    const importModeRaw = formData.get("importMode");
    const importMode: ImportMode = importModeRaw
      ? peopleImportModeSchema.parse(importModeRaw)
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
      mapping = apolloMappingSchema.parse(JSON.parse(mappingRaw)) as ApolloColumnMapping;
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
    return handleApiError(error, { request, fallbackMessage: "Failed to import people", fallbackCode: "people_import_failed" });
  }
}
