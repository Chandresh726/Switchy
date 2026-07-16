import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { childIdParamsSchema, skillUpdateBodySchema } from "@/lib/api/contracts/profile";
import { deleteSkill, updateSkill } from "@/lib/application/profile-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await context.params);
    const input = skillUpdateBodySchema.parse(await request.json());
    return NextResponse.json(await updateSkill(id, input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update skill", fallbackCode: "skill_update_failed" });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await context.params);
    return NextResponse.json(await deleteSkill(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete skill", fallbackCode: "skill_delete_failed" });
  }
}
