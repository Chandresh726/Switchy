import { settingsResponseSchema } from "@/lib/api/contracts/settings";

import { apiGet, apiPatch } from "../client";

export const getSettings = () => apiGet("/api/settings", settingsResponseSchema, "Failed to fetch settings");
export const patchSettings = (body: Record<string, unknown>) => apiPatch("/api/settings", body, settingsResponseSchema, "Failed to update settings");
