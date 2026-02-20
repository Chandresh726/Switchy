import { NextResponse } from "next/server";

import { AISettingsUpdateSchema } from "@/lib/ai/contracts";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";
import {
  clearSchedulerEnabledCache,
  getSchedulerEnabled,
  restartScheduler,
  stopScheduler,
} from "@/lib/jobs/scheduler";
import {
  DEFAULT_SETTINGS,
  getSettingsWithDefaults,
  parseSettingsUpdateBody,
  upsertSettings,
  type SettingKey,
} from "@/lib/settings/settings-service";

const AI_SETTING_KEYS: ReadonlySet<SettingKey> = new Set([
  "matcher_model",
  "matcher_provider_id",
  "matcher_reasoning_effort",
  "resume_parser_model",
  "resume_parser_provider_id",
  "resume_parser_reasoning_effort",
  "ai_writing_model",
  "ai_writing_provider_id",
  "ai_writing_reasoning_effort",
  "referral_tone",
  "referral_length",
  "cover_letter_tone",
  "cover_letter_length",
  "cover_letter_focus",
]);

function pickAISettings(body: Record<string, unknown>): Record<string, unknown> {
  const aiOnly: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (AI_SETTING_KEYS.has(key as SettingKey)) {
      aiOnly[key] = value;
    }
  }

  return aiOnly;
}

export async function GET() {
  try {
    const allSettings = await getSettingsWithDefaults();
    return NextResponse.json(allSettings);
  } catch (error) {
    return handleAIAPIError(error, "Failed to fetch settings", "settings_fetch_failed");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Request body must be an object", code: "invalid_request" },
        { status: 400 }
      );
    }

    const aiOnlyPayload = pickAISettings(body as Record<string, unknown>);
    if (Object.keys(aiOnlyPayload).length > 0) {
      AISettingsUpdateSchema.parse(aiOnlyPayload);
    }

    const { updates, cronUpdated, enabledChanged, newEnabledValue } = parseSettingsUpdateBody(body);

    if (updates.length > 0) {
      await upsertSettings(updates);
    }

    let shouldRestartScheduler = false;
    let shouldStopScheduler = false;

    if (enabledChanged) {
      clearSchedulerEnabledCache();
      if (newEnabledValue === true) {
        shouldRestartScheduler = true;
      } else {
        shouldStopScheduler = true;
      }
    } else if (cronUpdated) {
      clearSchedulerEnabledCache();
      const schedulerEnabled = await getSchedulerEnabled();
      if (schedulerEnabled) {
        shouldRestartScheduler = true;
      }
    }

    if (shouldStopScheduler) {
      try {
        stopScheduler();
        console.log("[Settings API] Scheduler stopped due to enabled change");
      } catch (error) {
        console.error("[Settings API] Failed to stop scheduler:", error);
      }
    }

    if (shouldRestartScheduler) {
      try {
        await restartScheduler();
        if (enabledChanged) {
          console.log("[Settings API] Scheduler started due to enabled change");
        } else if (cronUpdated) {
          console.log("[Settings API] Scheduler restarted due to cron change");
        }
      } catch (error) {
        if (enabledChanged) {
          console.error("[Settings API] Failed to start scheduler:", error);
        } else if (cronUpdated) {
          console.error("[Settings API] Failed to restart scheduler:", error);
        }
      }
    }

    const allSettings = await getSettingsWithDefaults();
    return NextResponse.json(allSettings);
  } catch (error) {
    return handleAIAPIError(error, "Failed to update settings", "settings_update_failed");
  }
}

export { DEFAULT_SETTINGS };
