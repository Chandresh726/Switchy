import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { personIdParamsSchema, personPatchBodySchema } from "@/lib/api/contracts/people";
import { archivePerson, getPersonDetail, updatePerson } from "@/lib/application/people-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = personIdParamsSchema.parse(await context.params);
    return NextResponse.json(await getPersonDetail(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch person", fallbackCode: "person_fetch_failed" });
  }
}

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

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = personIdParamsSchema.parse(await context.params);
    return NextResponse.json(await archivePerson(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to archive person", fallbackCode: "person_archive_failed" });
  }
}
