import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { peopleDuplicatesQuerySchema } from "@/lib/api/contracts/people";
import { listPeopleDuplicates } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const query = peopleDuplicatesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listPeopleDuplicates(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch duplicate people", fallbackCode: "people_duplicates_fetch_failed" });
  }
}
