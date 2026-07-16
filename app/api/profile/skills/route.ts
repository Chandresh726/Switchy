import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { profileIdQuerySchema, skillCreateBodySchema } from "@/lib/api/contracts/profile";
import { createSkill, listSkills } from "@/lib/application/profile-service";

export async function GET(request: NextRequest) {
  try {
    const { profileId } = profileIdQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listSkills(profileId));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch skills", fallbackCode: "skills_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const input = skillCreateBodySchema.parse(await request.json());
    return NextResponse.json(await createSkill(input));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create skill", fallbackCode: "skill_create_failed" });
  }
}
