import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import {
  getNativeNotificationPermission,
  openNativeNotificationSettings,
  prepareNativeNotifications,
  stopNativeNotifications,
} from "@/lib/notifications/native-notifier";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getNativeNotificationPermission());
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to check native notification permission",
      fallbackCode: "native_notifications_status_failed",
    });
  }
}

export async function POST(request: Request) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await prepareNativeNotifications());
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to enable native notifications",
      fallbackCode: "native_notifications_enable_failed",
    });
  }
}

export async function PUT(request: Request) {
  try {
    assertAppRequest(request);
    return NextResponse.json(openNativeNotificationSettings());
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to open native notification settings",
      fallbackCode: "native_notification_settings_failed",
    });
  }
}

export async function DELETE(request: Request) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await stopNativeNotifications());
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to stop native notifications",
      fallbackCode: "native_notifications_stop_failed",
    });
  }
}
