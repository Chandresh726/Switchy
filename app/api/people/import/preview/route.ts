import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { previewPeopleImport } from "@/lib/application/people-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await previewPeopleImport(await request.formData()));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to preview people import", fallbackCode: "people_import_preview_failed" });
  }
}
