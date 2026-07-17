import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { childIdParamsSchema, educationUpdateBodySchema } from "@/lib/api/contracts/profile";
import { deleteEducation, updateEducation } from "@/lib/application/profile-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await context.params);
    const input = educationUpdateBodySchema.parse(await request.json());
    return NextResponse.json(await updateEducation(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update education", fallbackCode: "education_update_failed" });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await context.params);
    return NextResponse.json(await deleteEducation(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete education", fallbackCode: "education_delete_failed" });
  }
}
