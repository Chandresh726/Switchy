import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { personIdParamsSchema, personMergeBodySchema } from "@/lib/api/contracts/people";
import { mergePeople } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = personIdParamsSchema.parse(await context.params);
    const input = personMergeBodySchema.parse(await request.json());
    return NextResponse.json(await mergePeople(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to merge people", fallbackCode: "person_merge_failed" });
  }
}
