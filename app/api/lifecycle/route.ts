import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { lifecycleActionSchema, lifecyclePreferencesPatchSchema } from "@/lib/api/contracts/lifecycle";
import { changeLifecyclePreferences, getLifecycleStatus, requestLifecycleUpdate } from "@/lib/runtime/lifecycle";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getLifecycleStatus(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Could not read startup and update status" });
  }
}

export async function PATCH(request: Request) {
  try {
    assertAppRequest(request);
    const changes = lifecyclePreferencesPatchSchema.parse(await request.json());
    await changeLifecyclePreferences({ ...changes, consented: true });
    return NextResponse.json(await getLifecycleStatus(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Could not save startup and update preferences" });
  }
}

export async function POST(request: Request) {
  try {
    assertAppRequest(request);
    const { action } = lifecycleActionSchema.parse(await request.json());
    await requestLifecycleUpdate(action);
    return NextResponse.json({ accepted: true }, { status: 202, headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Could not request an update" });
  }
}
