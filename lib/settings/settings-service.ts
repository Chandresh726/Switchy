import cron from "node-cron";
import { eq } from "drizzle-orm";

import { APIValidationError } from "@/lib/api/ai-error-handler";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { safeJsonParse } from "@/lib/utils/safe-json";

export const DEFAULT_SETTINGS = {
  matcher_model: "",
  matcher_provider_id: "",
  matcher_reasoning_effort: "medium",
  resume_parser_model: "",
  resume_parser_provider_id: "",
  resume_parser_reasoning_effort: "medium",
  matcher_bulk_enabled: "true",
  matcher_batch_size: "2",
  matcher_max_retries: "3",
  matcher_concurrency_limit: "3",
  matcher_serialize_operations: "false",
  matcher_timeout_ms: "30000",
  matcher_backoff_base_delay: "2000",
  matcher_backoff_max_delay: "32000",
  matcher_circuit_breaker_threshold: "10",
  matcher_circuit_breaker_reset_timeout: "60000",
  matcher_auto_match_after_scrape: "true",
  scheduler_enabled: "true",
  scheduler_cron: "0 */6 * * *",
  scraper_filter_country: "India",
  scraper_filter_city: "",
  scraper_filter_title_keywords: "[]",
  referral_tone: "professional",
  referral_length: "medium",
  cover_letter_tone: "professional",
  cover_letter_length: "medium",
  cover_letter_focus: "[\"skills\",\"experience\",\"cultural_fit\"]",
  ai_writing_model: "",
  ai_writing_provider_id: "",
  ai_writing_reasoning_effort: "medium",
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export interface ParsedSettingUpdate {
  key: SettingKey;
  value: string;
}

export interface ParsedSettingsUpdateResult {
  updates: ParsedSettingUpdate[];
  cronUpdated: boolean;
  enabledChanged: boolean;
  newEnabledValue: boolean | null;
}

function isSettingKey(value: string): value is SettingKey {
  return value in DEFAULT_SETTINGS;
}

function parseBooleanValue(value: unknown): string {
  return value === true || value === "true" ? "true" : "false";
}

function parseNumberInRange(
  key: SettingKey,
  value: unknown,
  min: number,
  max: number
): string {
  const parsed = parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new APIValidationError(
      `${key} must be a number between ${min} and ${max}`,
      "invalid_request"
    );
  }
  return String(parsed);
}

function ensureNonEmptyString(key: SettingKey, value: unknown): string {
  const parsed = String(value ?? "").trim();
  if (parsed.length === 0) {
    throw new APIValidationError(`${key} must be a non-empty string`, "invalid_request");
  }
  return parsed;
}

function ensureEnum<T extends readonly string[]>(
  key: SettingKey,
  value: unknown,
  allowed: T
): T[number] {
  const parsed = String(value);
  if (!allowed.includes(parsed)) {
    throw new APIValidationError(
      `${key} must be one of: ${allowed.join(", ")}`,
      "invalid_request"
    );
  }
  return parsed as T[number];
}

function normalizeTitleKeywords(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  if (typeof value === "string") {
    const parsed = safeJsonParse<unknown>(value, null);
    if (!Array.isArray(parsed)) {
      throw new APIValidationError(
        "scraper_filter_title_keywords must be a JSON array of strings",
        "invalid_request"
      );
    }

    return JSON.stringify(
      parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  throw new APIValidationError(
    "scraper_filter_title_keywords must be an array or JSON array string",
    "invalid_request"
  );
}

function normalizeCoverLetterFocus(value: unknown): string {
  const allowed = ["skills", "experience", "cultural_fit", "all"] as const;

  if (Array.isArray(value)) {
    const valid = value.filter(
      (item): item is "skills" | "experience" | "cultural_fit" =>
        typeof item === "string" && item !== "all" && allowed.includes(item as (typeof allowed)[number])
    );
    return JSON.stringify(valid);
  }

  if (typeof value !== "string") {
    throw new APIValidationError(
      "cover_letter_focus must be a string or JSON array string",
      "invalid_request"
    );
  }

  const trimmed = value.trim();
  const parsed = safeJsonParse<unknown>(trimmed, null);

  if (Array.isArray(parsed)) {
    const valid = parsed.filter(
      (item): item is "skills" | "experience" | "cultural_fit" =>
        typeof item === "string" && item !== "all" && allowed.includes(item as (typeof allowed)[number])
    );
    return JSON.stringify(valid);
  }

  if (allowed.includes(trimmed as (typeof allowed)[number])) {
    return trimmed;
  }

  throw new APIValidationError(
    "cover_letter_focus must be one of: skills, experience, cultural_fit, all",
    "invalid_request"
  );
}

function parseSettingValue(
  key: SettingKey,
  value: unknown
): { value: string; cronUpdated: boolean; enabledChanged: boolean; newEnabledValue: boolean | null } {
  switch (key) {
    case "matcher_batch_size":
      return { value: parseNumberInRange(key, value, 1, 10), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_max_retries":
      return { value: parseNumberInRange(key, value, 1, 10), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_concurrency_limit":
      return { value: parseNumberInRange(key, value, 1, 10), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_timeout_ms":
      return { value: parseNumberInRange(key, value, 5_000, 120_000), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_backoff_base_delay":
      return { value: parseNumberInRange(key, value, 500, 10_000), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_backoff_max_delay":
      return { value: parseNumberInRange(key, value, 5_000, 120_000), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_circuit_breaker_threshold":
      return { value: parseNumberInRange(key, value, 3, 50), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_circuit_breaker_reset_timeout":
      return { value: parseNumberInRange(key, value, 10_000, 300_000), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_bulk_enabled":
    case "matcher_serialize_operations":
    case "matcher_auto_match_after_scrape":
      return { value: parseBooleanValue(value), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "scheduler_cron": {
      const cronExpr = String(value ?? "").trim();
      if (!cron.validate(cronExpr)) {
        throw new APIValidationError("Invalid cron expression", "invalid_request");
      }
      return { value: cronExpr, cronUpdated: true, enabledChanged: false, newEnabledValue: null };
    }
    case "scheduler_enabled": {
      const parsed = parseBooleanValue(value);
      return {
        value: parsed,
        cronUpdated: false,
        enabledChanged: true,
        newEnabledValue: parsed === "true",
      };
    }
    case "matcher_model":
    case "resume_parser_model":
    case "ai_writing_model":
      return { value: ensureNonEmptyString(key, value), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_reasoning_effort":
    case "resume_parser_reasoning_effort":
    case "ai_writing_reasoning_effort":
      return {
        value: ensureEnum(key, value, ["low", "medium", "high"] as const),
        cronUpdated: false,
        enabledChanged: false,
        newEnabledValue: null,
      };
    case "scraper_filter_country":
    case "scraper_filter_city":
      return { value: String(value ?? ""), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "scraper_filter_title_keywords":
      return { value: normalizeTitleKeywords(value), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "referral_tone":
      return {
        value: ensureEnum(key, value, ["professional", "casual", "friendly", "flexible"] as const),
        cronUpdated: false,
        enabledChanged: false,
        newEnabledValue: null,
      };
    case "referral_length":
    case "cover_letter_length":
      return {
        value: ensureEnum(key, value, ["short", "medium", "long"] as const),
        cronUpdated: false,
        enabledChanged: false,
        newEnabledValue: null,
      };
    case "cover_letter_tone":
      return {
        value: ensureEnum(key, value, ["professional", "formal", "casual", "flexible"] as const),
        cronUpdated: false,
        enabledChanged: false,
        newEnabledValue: null,
      };
    case "cover_letter_focus":
      return { value: normalizeCoverLetterFocus(value), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    case "matcher_provider_id":
    case "resume_parser_provider_id":
    case "ai_writing_provider_id":
      return { value: String(value ?? "").trim(), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
    default:
      return { value: String(value ?? ""), cronUpdated: false, enabledChanged: false, newEnabledValue: null };
  }
}

export function parseSettingsUpdateBody(body: unknown): ParsedSettingsUpdateResult {
  if (typeof body !== "object" || body === null) {
    throw new APIValidationError("Request body must be an object", "invalid_request");
  }

  const updates: ParsedSettingUpdate[] = [];
  let cronUpdated = false;
  let enabledChanged = false;
  let newEnabledValue: boolean | null = null;

  for (const [rawKey, rawValue] of Object.entries(body)) {
    if (!isSettingKey(rawKey)) {
      continue;
    }

    const parsed = parseSettingValue(rawKey, rawValue);
    updates.push({ key: rawKey, value: parsed.value });
    cronUpdated = cronUpdated || parsed.cronUpdated;
    enabledChanged = enabledChanged || parsed.enabledChanged;
    if (parsed.newEnabledValue !== null) {
      newEnabledValue = parsed.newEnabledValue;
    }
  }

  return {
    updates,
    cronUpdated,
    enabledChanged,
    newEnabledValue,
  };
}

export async function upsertSettings(updates: ParsedSettingUpdate[]): Promise<void> {
  for (const { key, value } of updates) {
    const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({ value, updatedAt: new Date() })
        .where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value, updatedAt: new Date() });
    }
  }
}

export async function getSettingsWithDefaults(): Promise<Record<SettingKey, string>> {
  const allSettings = await db.select().from(settings);
  const result: Record<SettingKey, string> = { ...DEFAULT_SETTINGS };

  for (const setting of allSettings) {
    if (setting.value !== null && isSettingKey(setting.key)) {
      result[setting.key] = setting.value;
    }
  }

  return result;
}

export async function upsertSetting(key: SettingKey, value: string): Promise<void> {
  await upsertSettings([{ key, value }]);
}
