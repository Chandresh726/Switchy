import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { personIdParamsSchema, personPatchBodySchema } from "@/lib/api/contracts/people";
import { updatePerson } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = personIdParamsSchema.parse(await context.params);
    const input = personPatchBodySchema.parse(await request.json());
    return NextResponse.json(await updatePerson(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update person", fallbackCode: "person_update_failed" });
  }
}
