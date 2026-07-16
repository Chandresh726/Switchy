import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { importPeople } from "@/lib/application/people-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await importPeople(await request.formData()));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to import people", fallbackCode: "people_import_failed" });
  }
}
