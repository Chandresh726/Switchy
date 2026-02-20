import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

const PLATFORM_VALUES = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "eightfold",
  "uber",
  "custom",
] as const;

const PlatformOverrideSchema = z
  .union([z.enum(PLATFORM_VALUES), z.literal("")])
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const CompanyInputSchema = z.object({
  name: z.string().trim().min(1),
  careersUrl: z.string().trim().url(),
  logoUrl: z.string().trim().url().optional().or(z.literal("")),
  platform: PlatformOverrideSchema,
  boardToken: z.string().trim().optional().or(z.literal("")),
});

type CompanyInput = z.infer<typeof CompanyInputSchema>;

const MANUAL_BOARD_TOKEN_REQUIRED = new Set(["greenhouse", "lever", "ashby"]);

function normalizeOptionalText(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shouldRejectMissingBoardToken(input: CompanyInput, detectedFromUrl: string): boolean {
  const manualPlatform = input.platform;
  if (!manualPlatform) return false;

  if (!MANUAL_BOARD_TOKEN_REQUIRED.has(manualPlatform)) {
    return false;
  }

  const boardToken = normalizeOptionalText(input.boardToken);
  if (detectedFromUrl === manualPlatform) {
    return false;
  }

  return !boardToken;
}

async function upsertCompany(input: CompanyInput) {
  const manualPlatform = input.platform;
  const detectedFromUrl = detectPlatformFromUrl(input.careersUrl);
  const resolvedPlatform = manualPlatform ?? detectedFromUrl;
  const boardToken = normalizeOptionalText(input.boardToken);

  const [existing] = await db
    .select()
    .from(companies)
    .where(eq(companies.careersUrl, input.careersUrl));

  if (existing) {
    const [updated] = await db
      .update(companies)
      .set({
        name: input.name,
        logoUrl: normalizeOptionalText(input.logoUrl),
        platform: resolvedPlatform,
        boardToken,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, existing.id))
      .returning();

    return updated;
  }

  const [created] = await db
    .insert(companies)
    .values({
      name: input.name,
      careersUrl: input.careersUrl,
      logoUrl: normalizeOptionalText(input.logoUrl),
      platform: resolvedPlatform,
      boardToken,
      isActive: true,
    })
    .returning();

  return created;
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
    const isBulk = Array.isArray(body);
    const rawItems = isBulk ? body : [body];
    const results = [];

    for (const rawItem of rawItems) {
      const parsed = CompanyInputSchema.safeParse(rawItem);

      if (!parsed.success) {
        if (!isBulk) {
          return NextResponse.json(
            {
              error: "Invalid request body",
              details: parsed.error.flatten(),
            },
            { status: 400 }
          );
        }
        continue;
      }

      const input = parsed.data;
      const detectedFromUrl = detectPlatformFromUrl(input.careersUrl);

      if (shouldRejectMissingBoardToken(input, detectedFromUrl)) {
        if (!isBulk) {
          return NextResponse.json(
            {
              error: `boardToken is required when manually selecting ${input.platform} platform with a custom URL`,
            },
            { status: 400 }
          );
        }
        continue;
      }

      const result = await upsertCompany(input);
      if (result) {
        results.push(result);
      }
    }

    if (!isBulk) {
      if (results.length === 0) {
        return NextResponse.json(
          { error: "name and careersUrl are required" },
          { status: 400 }
        );
      }
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

    const validated: CompanyInput[] = [];
    for (const item of body) {
      const parsed = CompanyInputSchema.safeParse(item);
      if (parsed.success) {
        validated.push(parsed.data);
      }
    }

    const incomingUrls = new Set(validated.map((item) => item.careersUrl));

    for (const item of validated) {
      const detectedFromUrl = detectPlatformFromUrl(item.careersUrl);
      if (shouldRejectMissingBoardToken(item, detectedFromUrl)) {
        console.warn(
          `[Companies Sync] Skipping ${item.name}: boardToken required when manually selecting ${item.platform} platform with a custom URL`
        );
        continue;
      }

      await upsertCompany(item);
    }

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
