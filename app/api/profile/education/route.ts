import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { educationCreateBodySchema, profileIdQuerySchema } from "@/lib/api/contracts/profile";
import { createEducation, listEducation } from "@/lib/application/profile-service";

export async function GET(request: NextRequest) {
  try {
    const { profileId } = profileIdQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listEducation(profileId));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch education", fallbackCode: "education_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = educationCreateBodySchema.parse(await request.json());
    return NextResponse.json(await createEducation(input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create education", fallbackCode: "education_create_failed" });
  }
}
