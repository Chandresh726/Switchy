import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { experienceWriteBodySchema, profileIdQuerySchema } from "@/lib/api/contracts/profile";
import { createExperience, listExperience } from "@/lib/application/profile-service";

export async function GET(request: NextRequest) {
  try {
    const { profileId } = profileIdQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listExperience(profileId));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch experience", fallbackCode: "experience_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = experienceWriteBodySchema.parse(await request.json());
    return NextResponse.json(await createExperience(input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create experience", fallbackCode: "experience_create_failed" });
  }
}
