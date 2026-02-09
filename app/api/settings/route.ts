import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Default settings values
const DEFAULT_SETTINGS: Record<string, string> = {
  matcher_model: "gemini-3-flash",
  matcher_bulk_enabled: "true",
  matcher_batch_size: "2",
  matcher_max_retries: "3",
  matcher_concurrency_limit: "3",
  matcher_timeout_ms: "30000",
  matcher_backoff_base_delay: "2000",
  matcher_backoff_max_delay: "32000",
  matcher_circuit_breaker_threshold: "10",
  matcher_circuit_breaker_reset_timeout: "60000",
  matcher_auto_match_after_scrape: "true",
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
      } else if (key === "matcher_bulk_enabled" || key === "matcher_auto_match_after_scrape") {
        updates.push({ key, value: value === true || value === "true" ? "true" : "false" });
      } else if (key === "matcher_model") {
        if (typeof value !== "string" || value.trim().length === 0) {
          return NextResponse.json(
            { error: "matcher_model must be a non-empty string" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value).trim() });
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
