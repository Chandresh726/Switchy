import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST() {
  try {
    // Remove Google OAuth tokens and project ID
    await db.delete(settings).where(eq(settings.key, "google_oauth_tokens"));
    await db.delete(settings).where(eq(settings.key, "google_project_id"));

    // Reset AI provider if it was Google
    const provider = await db.select().from(settings).where(eq(settings.key, "ai_provider"));
    if (provider.length > 0 && provider[0].value === "google") {
        await db.update(settings).set({ value: "anthropic", updatedAt: new Date() }).where(eq(settings.key, "ai_provider"));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Google Disconnect Error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect Google account" },
      { status: 500 }
    );
  }
}
