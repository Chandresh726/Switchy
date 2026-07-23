import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import {
  resumeSectionApplyBodySchema,
  resumeSectionApplyResponseSchema,
} from "@/lib/api/contracts/profile";
import { applyResumeSection } from "@/lib/application/profile-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = resumeSectionApplyBodySchema.parse(await request.json());
    return NextResponse.json(
      resumeSectionApplyResponseSchema.parse(await applyResumeSection(input))
    );
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to apply resume changes",
      fallbackCode: "resume_changes_apply_failed",
    });
  }
}
