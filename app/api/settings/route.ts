import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { AISettingsUpdateSchema } from "@/lib/ai/contracts";
import { assertAppRequest } from "@/lib/api";
import { APIValidationError, handleAIAPIError } from "@/lib/api/ai-error-handler";
import { getCachedProviderModelDefinition } from "@/lib/ai/providers/model-catalog";

import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
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
  "job_analysis_model",
  "job_analysis_provider_id",
  "job_analysis_reasoning_effort",
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
  "follow_up_tone",
  "follow_up_length",
  "cover_letter_tone",
  "cover_letter_length",
  "cover_letter_focus",
  "codex_cli_executable",
  "opencode_cli_executable",
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

const LEGACY_REASONING_VALUES = new Set(["low", "medium", "high"]);
const REASONING_FEATURE_SETTINGS = [
  {
    provider: "job_analysis_provider_id",
    model: "job_analysis_model",
    effort: "job_analysis_reasoning_effort",
  },
  {
    provider: "matcher_provider_id",
    model: "matcher_model",
    effort: "matcher_reasoning_effort",
  },
  {
    provider: "resume_parser_provider_id",
    model: "resume_parser_model",
    effort: "resume_parser_reasoning_effort",
  },
  {
    provider: "ai_writing_provider_id",
    model: "ai_writing_model",
    effort: "ai_writing_reasoning_effort",
  },
] as const;

async function reconcileReasoningSettings(
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = await getSettingsWithDefaults();
  const reconciled = { ...body };

  for (const keys of REASONING_FEATURE_SETTINGS) {
    const touchesSelection = keys.provider in body || keys.model in body || keys.effort in body;
    if (!touchesSelection) continue;

    const providerId = String(body[keys.provider] ?? current[keys.provider]).trim();
    const modelId = String(body[keys.model] ?? current[keys.model]).trim();
    const requestedEffort = String(body[keys.effort] ?? current[keys.effort]);
    if (!providerId || !modelId) {
      reconciled[keys.effort] = "";
      continue;
    }

    const model = await getCachedProviderModelDefinition(providerId, modelId);
    if (!model) {
      throw new APIValidationError(
        "Refresh the selected provider's model catalog before saving AI settings",
        "invalid_request"
      );
    }

    if (model.reasoningControl.kind === "provider_default") {
      if (requestedEffort && !LEGACY_REASONING_VALUES.has(requestedEffort)) {
        throw new APIValidationError(
          `Model "${modelId}" does not advertise selectable reasoning efforts`,
          "invalid_request"
        );
      }
      reconciled[keys.effort] = "";
      continue;
    }

    const available = model.reasoningControl.options.map(({ value }) => value);
    const selected = requestedEffort || model.reasoningControl.defaultValue || available[0];
    if (!selected || !available.includes(selected)) {
      throw new APIValidationError(
        `Reasoning effort "${requestedEffort}" is unavailable for model "${modelId}"`,
        "invalid_request"
      );
    }
    reconciled[keys.effort] = selected;
  }

  return reconciled;
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
    assertAppRequest(request);

    const body = await request.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Request body must be an object", code: "invalid_request" },
        { status: 400 }
      );
    }

    const reconciledBody = await reconcileReasoningSettings(
      body as Record<string, unknown>
    );
    const aiOnlyPayload = pickAISettings(reconciledBody);
    if (Object.keys(aiOnlyPayload).length > 0) {
      AISettingsUpdateSchema.parse(aiOnlyPayload);
    }

    const { updates, cronUpdated, enabledChanged, newEnabledValue } = parseSettingsUpdateBody(reconciledBody);

    if (updates.length > 0) {
      await upsertSettings(updates);
      const updatedCLIProviders = updates.flatMap(({ key }) =>
        key === "codex_cli_executable"
          ? ["codex_cli" as const]
          : key === "opencode_cli_executable"
            ? ["opencode_cli" as const]
            : []
      );
      if (updatedCLIProviders.length > 0) {
        const { getLocalCLIStatus, resetLocalCLIProvider } = await import(
          "@/lib/ai/local-cli/service"
        );
        const { deleteStoredProviderModelsCache } = await import("@/lib/ai/providers/model-catalog");
        await Promise.all(updatedCLIProviders.map(async (provider) => {
          const records = await db
            .select({ id: aiProviders.id })
            .from(aiProviders)
            .where(eq(aiProviders.provider, provider));
          await resetLocalCLIProvider(provider);
          await Promise.all(records.map(({ id }) => deleteStoredProviderModelsCache(id)));
          await getLocalCLIStatus(provider, { forceRefresh: true });
        }));
      }
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
