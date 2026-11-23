import type { z } from "zod";

import { lifecycleAcceptedSchema, lifecycleActionSchema, lifecycleHeartbeatSchema, lifecycleHeartbeatResponseSchema, lifecyclePreferencesPatchSchema, lifecycleStatusSchema } from "@/lib/api/contracts/lifecycle";

import { apiJsonMutation, apiRequest } from "../client";

export const getLifecycleStatus = () => apiRequest(
  "/api/lifecycle", { method: "GET", cache: "no-store" }, lifecycleStatusSchema,
  "Could not read startup and update settings"
);

export const patchLifecyclePreferences = (body: z.input<typeof lifecyclePreferencesPatchSchema>) => apiJsonMutation(
  "/api/lifecycle", "PATCH", lifecyclePreferencesPatchSchema, body, lifecycleStatusSchema,
  "Could not save startup and update preferences"
);

export const requestLifecycleUpdate = (action: "check" | "download" | "install") => apiJsonMutation(
  "/api/lifecycle", "POST", lifecycleActionSchema, { action }, lifecycleAcceptedSchema,
  "Could not request an update"
);

export const sendLifecycleHeartbeat = (id: string) => apiRequest(
  "/api/lifecycle/heartbeat", {
    method: "POST", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", "X-Switchy-Request": "true" },
    body: JSON.stringify(lifecycleHeartbeatSchema.parse({ id })),
  }, lifecycleHeartbeatResponseSchema, "Could not check application status"
);
