import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { personIdParamsSchema } from "@/lib/api/contracts/people";
import { purgePerson } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = personIdParamsSchema.parse(await context.params);
    return NextResponse.json(await purgePerson(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to purge person", fallbackCode: "person_purge_failed" });
  }
}
