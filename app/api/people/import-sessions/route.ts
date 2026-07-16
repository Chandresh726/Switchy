import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { peopleImportSessionsQuerySchema } from "@/lib/api/contracts/people";
import { listPeopleImportSessions } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const { limit } = peopleImportSessionsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listPeopleImportSessions(limit));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch import sessions", fallbackCode: "people_import_sessions_fetch_failed" });
  }
}
