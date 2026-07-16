import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { peopleImportSessionsQuerySchema } from "@/lib/api/contracts/people";
import { db } from "@/lib/db";
import { peopleImportSessions } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  try {
    const query = peopleImportSessionsQuerySchema.parse({
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    const sessions = await db
      .select()
      .from(peopleImportSessions)
      .orderBy(desc(peopleImportSessions.startedAt))
      .limit(query.limit);

    return NextResponse.json(sessions);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch import sessions", fallbackCode: "people_import_sessions_fetch_failed" });
  }
}
