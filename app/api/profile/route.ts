import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { profileWriteBodySchema } from "@/lib/api/contracts/profile";
import { getProfile, saveProfile } from "@/lib/application/profile-service";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await getProfile());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch profile", fallbackCode: "profile_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = profileWriteBodySchema.parse(await request.json());
    return NextResponse.json(await saveProfile(input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to save profile", fallbackCode: "profile_save_failed" });
  }
}
