import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertAppRequest, createApiRequestContext, handleApiError, withRequestIdHeader } from "@/lib/api";
import {
  schedulerHostActionSchema,
} from "@/lib/api/contracts/runtime";
import {
  getSchedulerHostStatus,
  installSchedulerHost,
  syncSchedulerHost,
  uninstallSchedulerHost,
} from "@/lib/jobs/scheduler-host";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  const context = createApiRequestContext(request);
  try {
    const status = await getSchedulerHostStatus();
    return NextResponse.json(status, { headers: withRequestIdHeader(NO_STORE_HEADERS, context) });
  } catch (error) {
    return handleApiError(error, { request, context, fallbackMessage: "Failed to get scheduler host status", fallbackCode: "scheduler_host_status_failed", headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  const context = createApiRequestContext(request);
  try {
    assertAppRequest(request);
    const { action } = schedulerHostActionSchema.parse(await request.json());

    if (action === "install") {
      await installSchedulerHost();
    } else if (action === "uninstall") {
      await uninstallSchedulerHost();
    }

    const result = action === "sync" ? await syncSchedulerHost() : action === "install" ? "installed" : "removed";
    const status = await getSchedulerHostStatus();
    return NextResponse.json({ result, status }, { headers: withRequestIdHeader(NO_STORE_HEADERS, context) });
  } catch (error) {
    return handleApiError(error, { request, context, fallbackMessage: "Failed to sync scheduler host", fallbackCode: "scheduler_host_sync_failed", headers: NO_STORE_HEADERS });
  }
}
