import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
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
  if (urlLower.includes("ashbyhq.com") || urlLower.includes("jobs.ashbyhq.com")) {
    return "ashby";
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
    const items = Array.isArray(body) ? body : [body];
    const results = [];

    for (const item of items) {
      const { name, careersUrl, logoUrl, platform: manualPlatform, boardToken } = item;

      if (!name || !careersUrl) {
        if (!Array.isArray(body)) {
          return NextResponse.json(
            { error: "name and careersUrl are required" },
            { status: 400 }
          );
        }
        continue;
      }

      // Use manual platform if provided, otherwise auto-detect
      const platform = manualPlatform || detectPlatform(careersUrl);
      const detectedFromUrl = detectPlatform(careersUrl);

      // Validate boardToken is provided when manually selecting greenhouse/lever with custom URL
      if (
        manualPlatform &&
        manualPlatform !== "custom" &&
        detectedFromUrl !== manualPlatform &&
        !boardToken
      ) {
        if (!Array.isArray(body)) {
          return NextResponse.json(
            {
              error: `boardToken is required when manually selecting ${manualPlatform} platform with a custom URL`,
            },
            { status: 400 }
          );
        }
        // In bulk mode, maybe we skip or default? Let's skip for now to be safe
        continue;
      }

      // Check for existing company
      const [existing] = await db
        .select()
        .from(companies)
        .where(eq(companies.careersUrl, careersUrl));

      let result;
      if (existing) {
        [result] = await db
          .update(companies)
          .set({
            name,
            logoUrl,
            platform,
            boardToken: boardToken || null,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(companies.id, existing.id))
          .returning();
      } else {
        [result] = await db
          .insert(companies)
          .values({
            name,
            careersUrl,
            logoUrl,
            platform,
            boardToken: boardToken || null,
            scrapeFrequency: 6,
            isActive: true,
          })
          .returning();
      }
      results.push(result);
    }

    if (!Array.isArray(body)) {
      return NextResponse.json(results[0]);
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to create/import companies:", error);
    return NextResponse.json(
      { error: "Failed to create/import companies" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: "Expected array of companies" },
        { status: 400 }
      );
    }

    const incomingUrls = new Set(
      body.map((c: { careersUrl?: string }) => c.careersUrl).filter(Boolean)
    );

    // 1. Upsert incoming
    for (const item of body) {
      if (!item.name || !item.careersUrl) continue;

      const manualPlatform = item.platform;
      const detectedFromUrl = detectPlatform(item.careersUrl);
      const platform = manualPlatform || detectedFromUrl;

      // Validate boardToken is provided when manually selecting greenhouse/lever with custom URL
      if (
        manualPlatform &&
        manualPlatform !== "custom" &&
        detectedFromUrl !== manualPlatform &&
        !item.boardToken
      ) {
        // Skip items with inconsistent platform override without boardToken
        console.warn(
          `[Companies Sync] Skipping ${item.name}: boardToken required when manually selecting ${manualPlatform} platform with a custom URL`
        );
        continue;
      }

      const [existing] = await db
        .select()
        .from(companies)
        .where(eq(companies.careersUrl, item.careersUrl));

      if (existing) {
        await db
          .update(companies)
          .set({
            name: item.name,
            logoUrl: item.logoUrl,
            platform,
            boardToken: item.boardToken || null,
            isActive: true, // Ensure active if present in JSON
            updatedAt: new Date(),
          })
          .where(eq(companies.id, existing.id));
      } else {
        await db.insert(companies).values({
          name: item.name,
          careersUrl: item.careersUrl,
          logoUrl: item.logoUrl,
          platform,
          boardToken: item.boardToken || null,
          scrapeFrequency: 6,
          isActive: true,
        });
      }
    }

    // 2. Deactivate missing
    const allCompanies = await db.select().from(companies);
    for (const company of allCompanies) {
      if (!incomingUrls.has(company.careersUrl) && company.isActive) {
        await db
          .update(companies)
          .set({
            isActive: false,
            updatedAt: new Date(),
          })
          .where(eq(companies.id, company.id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to sync companies:", error);
    return NextResponse.json(
      { error: "Failed to sync companies" },
      { status: 500 }
    );
  }
}
