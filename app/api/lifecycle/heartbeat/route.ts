import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { lifecycleHeartbeatSchema } from "@/lib/api/contracts/lifecycle";
import { APP_VERSION } from "@/lib/constants";
import { isLifecycleSupported, recordBrowserHeartbeat } from "@/lib/runtime/lifecycle";
import { isUpdateMaintenance } from "@/lib/runtime/update-maintenance";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function POST(request: Request) {
  try {
    assertAppRequest(request);
    const { id } = lifecycleHeartbeatSchema.parse(await request.json());
    const supported = isLifecycleSupported();
    if (supported) await recordBrowserHeartbeat(id);
    return NextResponse.json({ version: APP_VERSION, updating: isUpdateMaintenance(), supported }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Could not check application status" });
  }
}
