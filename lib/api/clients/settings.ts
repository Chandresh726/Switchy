import {
  settingsResponseSchema,
  settingsUpdateBodySchema,
} from "@/lib/api/contracts/settings";
import type { z } from "zod";

import { apiGet, apiJsonMutation } from "../client";

export const getSettings = () => apiGet("/api/settings", settingsResponseSchema, "Failed to fetch settings");
export const patchSettings = (body: z.input<typeof settingsUpdateBodySchema>) => apiJsonMutation("/api/settings", "PATCH", settingsUpdateBodySchema, body, settingsResponseSchema, "Failed to update settings");
