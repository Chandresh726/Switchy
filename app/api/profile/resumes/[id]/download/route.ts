import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { numericIdParamsSchema } from "@/lib/api/contracts/matching";
import { downloadResume } from "@/lib/application/profile-resume-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = numericIdParamsSchema.parse(await params);
    const file = await downloadResume(id);
    return new NextResponse(file.body, { headers: file.headers });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to download resume", fallbackCode: "resume_download_failed" });
  }
}
