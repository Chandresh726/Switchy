import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Default settings values
const DEFAULT_SETTINGS: Record<string, string> = {
  matcher_model: "gemini-3-flash",
  matcher_bulk_enabled: "true",
  matcher_batch_size: "2",
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
      } else if (key === "matcher_bulk_enabled") {
        updates.push({ key, value: value === true || value === "true" ? "true" : "false" });
      } else if (key === "matcher_model") {
        if (typeof value !== "string" || value.trim().length === 0) {
          return NextResponse.json(
            { error: "matcher_model must be a non-empty string" },
            { status: 400 }
          );
        }
        updates.push({ key, value: String(value).trim() });
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
