import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { resumeUploadFormSchema } from "@/lib/api/contracts/profile";
import { uploadResume } from "@/lib/application/profile-resume-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const formData = await request.formData();
    const { file, autofill } = resumeUploadFormSchema.parse({
      file: formData.get("file"), autofill: formData.get("autofill") ?? undefined,
    });
    return NextResponse.json(await uploadResume(file, autofill, request.signal));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to parse resume", fallbackCode: "resume_parse_failed" });
  }
}
