import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { personSourceParamsSchema } from "@/lib/api/contracts/people";
import { splitPersonSource } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string; sourceRecordId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id, sourceRecordId } = personSourceParamsSchema.parse(await context.params);
    return NextResponse.json(await splitPersonSource(id, sourceRecordId));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to split person source", fallbackCode: "person_source_split_failed" });
  }
}
