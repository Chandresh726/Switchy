import { z } from "zod";

export const notificationActionResponseSchema = z.object({
  success: z.literal(true),
});

const nativeNotificationPermissionSchema = z.enum([
  "granted",
  "denied",
  "not_determined",
  "unavailable",
]);

export const notificationPermissionResponseSchema = z.object({
  success: z.literal(true),
  permission: nativeNotificationPermissionSchema,
});

export type NativeNotificationPermission = z.infer<typeof nativeNotificationPermissionSchema>;

export const notificationTestResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});
