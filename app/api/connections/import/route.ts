import { NextRequest, NextResponse } from "next/server";

import { handleApiError, ValidationError } from "@/lib/api";
import { importConnectionsCsv } from "@/lib/connections/sync";
import { MAX_CSV_FILE_SIZE } from "@/lib/constants";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
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
    const result = await importConnectionsCsv(content, file.name);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
