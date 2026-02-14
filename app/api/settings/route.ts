import { NextResponse } from "next/server";
import cron from "node-cron";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { restartScheduler } from "@/lib/jobs/scheduler";

const DEFAULT_SETTINGS: Record<string, string> = {
  matcher_model: "gemini-3-flash-preview",
  resume_parser_model: "gemini-3-flash-preview",
  matcher_reasoning_effort: "medium",
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
  scheduler_cron: "0 */6 * * *",
  ai_provider: "gemini_api_key",
  anthropic_api_key: "",
  google_auth_mode: "api_key",
  google_api_key: "",
  google_client_id: "",
  google_client_secret: "",
  openrouter_api_key: "",
  cerebras_api_key: "",
  openai_api_key: "",
  modal_api_key: "",
  scraper_filter_country: "India",
  scraper_filter_city: "",
  scraper_filter_title_keywords: "[]",
  // AI Writing settings
  referral_tone: "professional",
  referral_length: "medium",
  cover_letter_tone: "professional",
  cover_letter_length: "medium",
  cover_letter_focus: '["skills","experience","cultural_fit"]',
  ai_writing_model: "gemini-3-flash-preview",
  ai_writing_reasoning_effort: "medium",
};

// GET - fetch all settings
export async function GET() {
  try {
    const allSettings = await db.select().from(settings);

    // Build response with defaults for missing keys
    const result: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const setting of allSettings) {
      if (setting.value !== null) {
        result[setting.key] = setting.value;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Settings API] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// POST - update settings
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate that body is an object
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400 }
      );
    }

    // Track if cron was updated to restart scheduler
    let cronUpdated = false;
    const updates: { key: string; value: string }[] = [];

    for (const [key, value] of Object.entries(body)) {
      // Only allow known settings keys
      if (!(key in DEFAULT_SETTINGS)) {
        continue;
      }

      // Validate values based on key
      if (key === "matcher_batch_size") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 1 || num > 10) {
          return NextResponse.json(
            { error: "matcher_batch_size must be a number between 1 and 10" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_auto_match_after_scrape") {
        updates.push({ key, value: value === true || value === "true" ? "true" : "false" });
      } else if (key === "matcher_bulk_enabled") {
        updates.push({ key, value: value === true || value === "true" ? "true" : "false" });
      } else if (key === "matcher_serialize_operations") {
        updates.push({ key, value: value === true || value === "true" ? "true" : "false" });
      } else if (key === "scheduler_cron") {
        const cronExpr = String(value).trim();
        if (!cron.validate(cronExpr)) {
          return NextResponse.json(
            { error: "Invalid cron expression" },
            { status: 400 }
          );
        }
        updates.push({ key, value: cronExpr });
        cronUpdated = true;
      } else if (key === "matcher_model" || key === "resume_parser_model") {
        if (typeof value !== "string" || value.trim().length === 0) {
          return NextResponse.json(
            { error: `${key} must be a non-empty string` },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value).trim() });
      } else if (key === "matcher_reasoning_effort" || key === "resume_parser_reasoning_effort") {
        if (!["low", "medium", "high"].includes(String(value))) {
          return NextResponse.json(
            { error: `${key} must be one of: low, medium, high` },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "matcher_max_retries") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 1 || num > 10) {
          return NextResponse.json(
            { error: "matcher_max_retries must be a number between 1 and 10" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_concurrency_limit") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 1 || num > 10) {
          return NextResponse.json(
            { error: "matcher_concurrency_limit must be a number between 1 and 10" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_timeout_ms") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 5000 || num > 120000) {
          return NextResponse.json(
            { error: "matcher_timeout_ms must be a number between 5000 and 120000" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_backoff_base_delay") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 500 || num > 10000) {
          return NextResponse.json(
            { error: "matcher_backoff_base_delay must be a number between 500 and 10000" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_backoff_max_delay") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 5000 || num > 120000) {
          return NextResponse.json(
            { error: "matcher_backoff_max_delay must be a number between 5000 and 120000" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_circuit_breaker_threshold") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 3 || num > 50) {
          return NextResponse.json(
            { error: "matcher_circuit_breaker_threshold must be a number between 3 and 50" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "matcher_circuit_breaker_reset_timeout") {
        const num = parseInt(String(value), 10);
        if (isNaN(num) || num < 10000 || num > 300000) {
          return NextResponse.json(
            { error: "matcher_circuit_breaker_reset_timeout must be a number between 10000 and 300000" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(num) });
      } else if (key === "ai_provider") {
        if (
          value !== "anthropic" &&
          value !== "gemini_api_key" &&
          value !== "gemini_cli_oauth" &&
          value !== "openrouter" &&
          value !== "cerebras" &&
          value !== "openai" &&
          value !== "google" &&
          value !== "modal"
        ) {
          return NextResponse.json(
            { error: "ai_provider must be a supported provider" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "google_auth_mode") {
        if (value !== "api_key" && value !== "oauth") {
          return NextResponse.json(
            { error: "google_auth_mode must be either 'api_key' or 'oauth'" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "scraper_filter_country" || key === "scraper_filter_city") {
        // Allow any string value for location filters
        updates.push({ key, value: String(value || "") });
      } else if (key === "scraper_filter_title_keywords") {
        // Store as JSON array string; accept array or string
        let normalized: string;
        if (Array.isArray(value)) {
          const arr = value.filter((v) => typeof v === "string").map((v) => String(v).trim()).filter(Boolean);
          normalized = JSON.stringify(arr);
        } else if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) throw new Error("Not an array");
            const arr = parsed.filter((v) => typeof v === "string").map((v) => String(v).trim()).filter(Boolean);
            normalized = JSON.stringify(arr);
          } catch {
            return NextResponse.json(
              { error: "scraper_filter_title_keywords must be a JSON array of strings" },
              { status: 400 }
            );
          }
        } else {
          return NextResponse.json(
            { error: "scraper_filter_title_keywords must be an array or JSON array string" },
            { status: 400 }
          );
        }
        updates.push({ key, value: normalized });
      } else if (
        [
          "anthropic_api_key",
          "google_api_key",
          "google_client_id",
          "google_client_secret",
          "openrouter_api_key",
          "cerebras_api_key",
          "openai_api_key",
          "modal_api_key",
        ].includes(key)
      ) {
        // Allow empty strings
        updates.push({ key, value: String(value || "") });
      } else if (key === "referral_tone") {
        if (!["professional", "casual", "friendly", "flexible"].includes(String(value))) {
          return NextResponse.json(
            { error: "referral_tone must be one of: professional, casual, friendly, flexible" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "referral_length") {
        if (!["short", "medium", "long"].includes(String(value))) {
          return NextResponse.json(
            { error: "referral_length must be one of: short, medium, long" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "cover_letter_tone") {
        if (!["professional", "formal", "casual", "flexible"].includes(String(value))) {
          return NextResponse.json(
            { error: "cover_letter_tone must be one of: professional, formal, casual, flexible" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "cover_letter_length") {
        if (!["short", "medium", "long"].includes(String(value))) {
          return NextResponse.json(
            { error: "cover_letter_length must be one of: short, medium, long" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      } else if (key === "cover_letter_focus") {
        // Accept either a JSON array string or a single string
        let normalized: string;
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              const arr = parsed.filter((v) => typeof v === "string" && ["skills", "experience", "cultural_fit"].includes(v));
              normalized = JSON.stringify(arr);
            } else if (["skills", "experience", "cultural_fit", "all"].includes(parsed)) {
              normalized = parsed;
            } else {
              return NextResponse.json(
                { error: "cover_letter_focus must be an array or one of: skills, experience, cultural_fit, all" },
                { status: 400 }
              );
            }
          } catch {
            if (["skills", "experience", "cultural_fit", "all"].includes(value)) {
              normalized = value;
            } else {
              return NextResponse.json(
                { error: "cover_letter_focus must be one of: skills, experience, cultural_fit, all" },
                { status: 400 }
              );
            }
          }
        } else {
          return NextResponse.json(
            { error: "cover_letter_focus must be a string or JSON array string" },
            { status: 400 }
          );
        }
        updates.push({ key, value: normalized });
      } else if (key === "ai_writing_model") {
        if (typeof value !== "string" || value.trim().length === 0) {
          return NextResponse.json(
            { error: "ai_writing_model must be a non-empty string" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value).trim() });
      } else if (key === "ai_writing_reasoning_effort") {
        if (!["low", "medium", "high"].includes(String(value))) {
          return NextResponse.json(
            { error: "ai_writing_reasoning_effort must be one of: low, medium, high" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value) });
      }
    }

    // Upsert each setting
    for (const { key, value } of updates) {
      const existing = await db.select().from(settings).where(eq(settings.key, key));

      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value, updatedAt: new Date() })
          .where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value, updatedAt: new Date() });
      }
    }

    // Restart scheduler if cron was updated
    if (cronUpdated) {
      try {
        await restartScheduler();
        console.log("[Settings API] Scheduler restarted due to cron change");
      } catch (error) {
        console.error("[Settings API] Failed to restart scheduler:", error);
      }
    }

    // Return updated settings
    const allSettings = await db.select().from(settings);
    const result: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const setting of allSettings) {
      if (setting.value !== null) {
        result[setting.key] = setting.value;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Settings API] POST error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
