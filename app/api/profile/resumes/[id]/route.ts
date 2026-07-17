import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { childIdParamsSchema } from "@/lib/api/contracts/profile";
import { deleteResume } from "@/lib/application/profile-resume-service";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAppRequest(request);
    const { id } = childIdParamsSchema.parse(await params);
    return NextResponse.json(await deleteResume(id));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete resume", fallbackCode: "resume_delete_failed" });
  }
}
