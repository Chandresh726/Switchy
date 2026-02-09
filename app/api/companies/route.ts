import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// Detect platform from URL
function detectPlatform(url: string): string | null {
  const urlLower = url.toLowerCase();

  if (urlLower.includes("greenhouse.io") || urlLower.includes("boards.greenhouse")) {
    return "greenhouse";
  }
  if (urlLower.includes("lever.co") || urlLower.includes("jobs.lever")) {
    return "lever";
  }

  return "custom";
}

export async function GET() {
  try {
    const companiesData = await db
      .select()
      .from(companies)
      .orderBy(desc(companies.createdAt));

    return NextResponse.json(companiesData);
  } catch (error) {
    console.error("Failed to fetch companies:", error);
    return NextResponse.json(
      { error: "Failed to fetch companies" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, careersUrl, logoUrl, scrapeFrequency, platform: manualPlatform, boardToken } = body;

    if (!name || !careersUrl) {
      return NextResponse.json(
        { error: "name and careersUrl are required" },
        { status: 400 }
      );
    }

    // Use manual platform if provided, otherwise auto-detect
    const platform = manualPlatform || detectPlatform(careersUrl);
    const detectedFromUrl = detectPlatform(careersUrl);

    // Validate boardToken is provided when manually selecting greenhouse/lever with custom URL
    if (manualPlatform && manualPlatform !== "custom" && detectedFromUrl !== manualPlatform && !boardToken) {
      return NextResponse.json(
        { error: `boardToken is required when manually selecting ${manualPlatform} platform with a custom URL` },
        { status: 400 }
      );
    }

    const [newCompany] = await db
      .insert(companies)
      .values({
        name,
        careersUrl,
        logoUrl,
        platform,
        boardToken: boardToken || null,
        scrapeFrequency: scrapeFrequency || 6,
        isActive: true,
      })
      .returning();

    return NextResponse.json(newCompany);
  } catch (error) {
    console.error("Failed to create company:", error);
    return NextResponse.json(
      { error: "Failed to create company" },
      { status: 500 }
    );
  }
}
