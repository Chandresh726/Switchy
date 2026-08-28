import {
  notificationActionResponseSchema,
  notificationPermissionResponseSchema,
  notificationTestResponseSchema,
} from "@/lib/api/contracts/notifications";

import { apiCommand, apiGet } from "../client";

export const getNativeNotificationPermission = () => apiGet(
  "/api/notifications/native",
  notificationPermissionResponseSchema,
  "Failed to check native notification permission"
);

export const requestNativeNotificationPermission = () => apiCommand(
  "/api/notifications/native",
  "POST",
  notificationPermissionResponseSchema,
  "Failed to request native notification permission"
);

export const openNativeNotificationSettings = () => apiCommand(
  "/api/notifications/native",
  "PUT",
  notificationActionResponseSchema,
  "Failed to open native notification settings"
);

export const stopNativeNotifications = () => apiCommand(
  "/api/notifications/native",
  "DELETE",
  notificationActionResponseSchema,
  "Failed to stop native notifications"
);

export const sendTestNotification = () => apiCommand(
  "/api/notifications/test",
  "POST",
  notificationTestResponseSchema,
  "Failed to send test notification"
);
