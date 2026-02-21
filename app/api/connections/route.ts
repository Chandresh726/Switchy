import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError } from "@/lib/api";
import { deleteAllConnections, getConnectionsList } from "@/lib/connections/sync";

const ConnectionsQuerySchema = z.object({
  search: z.string().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  starred: z.enum(["true", "false"]).optional(),
  active: z.enum(["true", "false", "all"]).optional(),
  unmatched: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.enum(["lastSeenAt", "fullName", "createdAt", "isStarred"]).optional().default("lastSeenAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export async function GET(request: NextRequest) {
  try {
    const query = ConnectionsQuerySchema.parse({
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      companyId: request.nextUrl.searchParams.get("companyId") ?? undefined,
      starred: request.nextUrl.searchParams.get("starred") ?? undefined,
      active: request.nextUrl.searchParams.get("active") ?? undefined,
      unmatched: request.nextUrl.searchParams.get("unmatched") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
      sortBy: request.nextUrl.searchParams.get("sortBy") ?? undefined,
      sortOrder: request.nextUrl.searchParams.get("sortOrder") ?? undefined,
    });

    const result = await getConnectionsList({
      search: query.search,
      companyId: query.companyId,
      starred: query.starred ? query.starred === "true" : undefined,
      active: query.active === "all" ? "all" : query.active ? query.active === "true" : true,
      unmatched: query.unmatched ? query.unmatched === "true" : undefined,
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    const result = await deleteAllConnections();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
