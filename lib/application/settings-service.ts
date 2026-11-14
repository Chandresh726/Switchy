import { eq } from "drizzle-orm";

import { AISettingsUpdateSchema } from "@/lib/ai/contracts";
import { getCachedProviderModelDefinition } from "@/lib/ai/providers/model-catalog";
import { ValidationError, logApiFailure, type ApiRequestContext } from "@/lib/api";
import type { settingsUpdateBodySchema } from "@/lib/api/contracts/settings";
import { db } from "@/lib/db";
import { getActivitySleepInhibitor } from "@/lib/runtime/activity-sleep-inhibitor";
import { aiProviders } from "@/lib/db/schema";
import {
  getSchedulerEnabled,
  handleSchedulerDisabled,
  handleSchedulerEnabled,
  restartScheduler,
  stopScheduler,
} from "@/lib/jobs/scheduler";
import {
  getSettingsWithDefaults,
  parseSettingsUpdateBody,
  upsertSettings,
  type SettingKey,
} from "@/lib/settings/settings-service";

import type { z } from "zod";

type SettingsUpdateInput = z.infer<typeof settingsUpdateBodySchema>;

const AI_SETTING_KEYS: ReadonlySet<SettingKey> = new Set([
  "job_analysis_fallback_provider_id",
  "job_analysis_fallback_model",
  "job_analysis_fallback_reasoning_effort",
  "matcher_fallback_provider_id",
  "matcher_fallback_model",
  "matcher_fallback_reasoning_effort",

  "job_analysis_model", "job_analysis_provider_id", "job_analysis_reasoning_effort",
  "matcher_model", "matcher_provider_id", "matcher_reasoning_effort",
  "resume_parser_model", "resume_parser_provider_id", "resume_parser_reasoning_effort",
  "ai_writing_model", "ai_writing_provider_id", "ai_writing_reasoning_effort",
  "referral_tone", "referral_length", "follow_up_tone", "follow_up_length",
  "cover_letter_tone", "cover_letter_length", "cover_letter_focus",
  "codex_cli_executable", "opencode_cli_executable",
]);

const LEGACY_REASONING_VALUES = new Set(["low", "medium", "high"]);
const REASONING_FEATURE_SETTINGS = [
  { provider: "job_analysis_fallback_provider_id", model: "job_analysis_fallback_model", effort: "job_analysis_fallback_reasoning_effort" },
  { provider: "matcher_fallback_provider_id", model: "matcher_fallback_model", effort: "matcher_fallback_reasoning_effort" },

  { provider: "job_analysis_provider_id", model: "job_analysis_model", effort: "job_analysis_reasoning_effort" },
  { provider: "matcher_provider_id", model: "matcher_model", effort: "matcher_reasoning_effort" },
  { provider: "resume_parser_provider_id", model: "resume_parser_model", effort: "resume_parser_reasoning_effort" },
  { provider: "ai_writing_provider_id", model: "ai_writing_model", effort: "ai_writing_reasoning_effort" },
] as const;

function pickAISettings(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([key]) => AI_SETTING_KEYS.has(key as SettingKey)));
}

async function reconcileReasoningSettings(body: Record<string, unknown>) {
  const current = await getSettingsWithDefaults();
  const reconciled = { ...body };
  for (const keys of REASONING_FEATURE_SETTINGS) {
    const fallbackEnabledKey = keys.provider.includes("_fallback_")
      ? keys.provider.replace("provider_id", "enabled") as SettingKey : undefined;
    if (!(keys.provider in body || keys.model in body || keys.effort in body || (fallbackEnabledKey && fallbackEnabledKey in body))) continue;
    if (keys.provider.includes("_fallback_") && !String(body[keys.model] ?? current[keys.model]).trim()) {
      reconciled[keys.effort] = "";
      continue;
    }
    if (keys.provider.includes("_fallback_")) {
      const enabledKey = keys.provider.replace("provider_id", "enabled") as SettingKey;
      if (String(body[enabledKey] ?? current[enabledKey]) !== "true") continue;
    }
    const providerId = String(body[keys.provider] ?? current[keys.provider]).trim();
    const modelId = String(body[keys.model] ?? current[keys.model]).trim();
    const requestedEffort = String(body[keys.effort] ?? current[keys.effort]);
    if (!providerId || !modelId) {
      reconciled[keys.effort] = "";
      continue;
    }
    const model = await getCachedProviderModelDefinition(providerId, modelId);
    if (!model) {
      throw new ValidationError("Refresh the selected provider's model catalog before saving AI settings", "invalid_request");
    }
    if (model.reasoningControl.kind === "provider_default") {
      if (requestedEffort && !LEGACY_REASONING_VALUES.has(requestedEffort)) {
        throw new ValidationError(`Model "${modelId}" does not advertise selectable reasoning efforts`, "invalid_request");
      }
      reconciled[keys.effort] = "";
      continue;
    }
    const available = model.reasoningControl.options.map(({ value }) => value);
    const selected = requestedEffort || model.reasoningControl.defaultValue || available[0];
    if (!selected || !available.includes(selected)) {
      throw new ValidationError(`Reasoning effort "${requestedEffort}" is unavailable for model "${modelId}"`, "invalid_request");
    }
    reconciled[keys.effort] = selected;
  }
  return reconciled;
}

export const getSettings = () => getSettingsWithDefaults();

export async function updateSettings(input: SettingsUpdateInput, context: ApiRequestContext) {
  const current = await getSettingsWithDefaults();
  const merged = { ...current, ...input };
  for (const stage of ["job_analysis", "matcher"] as const) {
    if (String(merged[`${stage}_fallback_enabled`]) !== "true") continue;
    const provider = String(merged[`${stage}_fallback_provider_id`] ?? "").trim();
    const model = String(merged[`${stage}_fallback_model`] ?? "").trim();
    if (!provider || !model) throw new ValidationError("Choose a provider and model before enabling fallback", "invalid_request");
    const primaryProvider = merged[`${stage}_provider_id`] || merged.matcher_provider_id;
    const primaryModel = merged[`${stage}_model`] || merged.matcher_model;
    if (provider === primaryProvider && model === primaryModel) {
      throw new ValidationError("Fallback must use a different provider or model", "invalid_request");
    }
    if (!(await getCachedProviderModelDefinition(provider, model))) {
      throw new ValidationError("Refresh the fallback provider's model catalog before enabling fallback", "invalid_request");
    }
  }
  const reconciled = await reconcileReasoningSettings(input);
  const aiPayload = pickAISettings(reconciled);
  if (Object.keys(aiPayload).length > 0) AISettingsUpdateSchema.parse(aiPayload);
  const { updates, cronUpdated, enabledChanged, newEnabledValue, keepAwakeChanged = false } = parseSettingsUpdateBody(reconciled);
  if (updates.length > 0) {
    await upsertSettings(updates);
    const cliProviders = updates.flatMap(({ key }) => key === "codex_cli_executable"
      ? ["codex_cli" as const]
      : key === "opencode_cli_executable" ? ["opencode_cli" as const] : []);
    if (cliProviders.length > 0) {
      const { getLocalCLIStatus, resetLocalCLIProvider } = await import("@/lib/ai/local-cli/service");
      const { deleteStoredProviderModelsCache } = await import("@/lib/ai/providers/model-catalog");
      await Promise.all(cliProviders.map(async (provider) => {
        const records = await db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.provider, provider));
        await resetLocalCLIProvider(provider);
        await Promise.all(records.map(({ id }) => deleteStoredProviderModelsCache(id)));
        await getLocalCLIStatus(provider, { forceRefresh: true });
      }));
    }
  }

  let shouldRestart = false;
  let shouldStop = false;
  if (enabledChanged) {
    shouldRestart = newEnabledValue === true;
    shouldStop = !shouldRestart;
  } else if (cronUpdated) {
    shouldRestart = await getSchedulerEnabled();
  }
  if (shouldStop) {
    try { stopScheduler(); } catch (error) { logApiFailure(context, "scheduler_stop_failed", 500, error); }
    try {
      await handleSchedulerDisabled();
    } catch (error) { logApiFailure(context, "scheduler_recovery_clear_failed", 500, error); }
  }
  if (shouldRestart) {
    try { await restartScheduler(); } catch (error) {
      logApiFailure(context, enabledChanged ? "scheduler_start_failed" : "scheduler_restart_failed", 500, error);
    }
    if (enabledChanged && newEnabledValue === true) {
      // Fresh baseline: ticks from the disabled window must never backfill.
      try {
        await handleSchedulerEnabled();
      } catch (error) { logApiFailure(context, "scheduler_baseline_reset_failed", 500, error); }
    }
  }
  if (keepAwakeChanged) await getActivitySleepInhibitor().refresh();
  if (enabledChanged || cronUpdated) {
    // The frontend only flips settings. The backend owns OS-level persistence:
    // keep the macOS LaunchAgent in sync without ever failing the save.
    try {
      const { syncSchedulerHost } = await import("@/lib/jobs/scheduler-host");
      await syncSchedulerHost();
    } catch (error) {
      console.warn("[Settings] Scheduler host sync skipped:", error);
    }
  }
  return getSettingsWithDefaults();
}
