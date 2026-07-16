import { NextResponse } from "next/server";

import { assertAppRequest, createApiRequestContext, handleApiError } from "@/lib/api";
import { settingsUpdateBodySchema } from "@/lib/api/contracts/settings";
import { getSettings, updateSettings } from "@/lib/application/settings-service";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getSettings());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch settings", fallbackCode: "settings_fetch_failed" });
  }
}

export async function PATCH(request: Request) {
  try {
    assertAppRequest(request);
    const input = settingsUpdateBodySchema.parse(await request.json());
    return NextResponse.json(await updateSettings(input, createApiRequestContext(request)));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update settings", fallbackCode: "settings_update_failed" });
  }
}
