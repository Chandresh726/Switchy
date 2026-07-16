import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { childIdParamsSchema, experienceUpdateBodySchema } from "@/lib/api/contracts/profile";
import { deleteExperience, updateExperience } from "@/lib/application/profile-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await context.params);
    const input = experienceUpdateBodySchema.parse(await request.json());
    return NextResponse.json(await updateExperience(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update experience", fallbackCode: "experience_update_failed" });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await context.params);
    return NextResponse.json(await deleteExperience(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete experience", fallbackCode: "experience_delete_failed" });
  }
}
