import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { sendNotificationTest } from "@/lib/notifications/service";

export async function POST(request: Request) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await sendNotificationTest());
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to send test notification",
      fallbackCode: "notification_test_failed",
    });
  }
}
