import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { peopleImportSessionDetailQuerySchema, peopleImportSessionParamsSchema } from "@/lib/api/contracts/people";
import { getPeopleImportSession } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = peopleImportSessionParamsSchema.parse(await context.params);
    const query = peopleImportSessionDetailQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await getPeopleImportSession(id, query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch people import session", fallbackCode: "people_import_session_fetch_failed" });
  }
}
