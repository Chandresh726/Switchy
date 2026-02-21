import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { connectionImportSessions } from "@/lib/db/schema";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export async function GET(request: NextRequest) {
  try {
    const query = QuerySchema.parse({
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    const sessions = await db
      .select()
      .from(connectionImportSessions)
      .orderBy(desc(connectionImportSessions.startedAt))
      .limit(query.limit);

    return NextResponse.json(sessions);
  } catch (error) {
    return handleApiError(error);
  }
}
