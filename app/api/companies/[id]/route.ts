import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

const ParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

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
  .union([z.enum(PLATFORM_VALUES), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

const PutBodySchema = z.object({
  name: z.string().trim().min(1),
  careersUrl: z.string().trim().url(),
  logoUrl: z.string().trim().url().nullable().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  platform: PlatformOverrideSchema,
  boardToken: z.string().trim().nullable().optional().or(z.literal("")),
});

const PatchBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  careersUrl: z.string().trim().url().optional(),
  logoUrl: z.string().trim().url().nullable().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  platform: PlatformOverrideSchema,
  boardToken: z.string().trim().nullable().optional().or(z.literal("")),
});

type CompanyUpdatePayload = {
  name?: string;
  careersUrl?: string;
  logoUrl?: string | null;
  isActive?: boolean;
  platform?: "greenhouse" | "lever" | "ashby" | "workday" | "eightfold" | "uber" | "custom" | null;
  boardToken?: string | null;
  updatedAt: Date;
};

const MANUAL_BOARD_TOKEN_REQUIRED = new Set(["greenhouse", "lever", "ashby"]);

function normalizeOptionalText(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateBoardTokenRequirement(
  platform: CompanyUpdatePayload["platform"],
  careersUrl: string | undefined,
  boardToken: string | null | undefined
): string | null {
  if (!platform || !careersUrl || !MANUAL_BOARD_TOKEN_REQUIRED.has(platform)) {
    return null;
  }

  const detected = detectPlatformFromUrl(careersUrl);
  if (detected === platform) {
    return null;
  }

  if (!boardToken) {
    return `boardToken is required when manually selecting ${platform} platform with a custom URL`;
  }

  return null;
}

async function getIdFromParams(params: Promise<{ id: string }>): Promise<number> {
  const resolved = await params;
  const parsed = ParamsSchema.safeParse(resolved);
  if (!parsed.success) {
    throw new Error("Invalid company id");
  }
  return parsed.data.id;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = await getIdFromParams(params);

    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, id));

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    console.error("Failed to fetch company:", error);
    return NextResponse.json(
      { error: "Failed to fetch company" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = await getIdFromParams(params);
    const body = await request.json();
    const parsed = PutBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const updateData: CompanyUpdatePayload = {
      name: payload.name,
      careersUrl: payload.careersUrl,
      logoUrl: normalizeOptionalText(payload.logoUrl),
      isActive: payload.isActive,
      platform: payload.platform,
      boardToken: normalizeOptionalText(payload.boardToken),
      updatedAt: new Date(),
    };

    const boardTokenError = validateBoardTokenRequirement(
      updateData.platform,
      updateData.careersUrl,
      updateData.boardToken
    );

    if (boardTokenError) {
      return NextResponse.json({ error: boardTokenError }, { status: 400 });
    }

    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(eq(companies.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    console.error("Failed to update company:", error);
    return NextResponse.json(
      { error: "Failed to update company" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = await getIdFromParams(params);
    const body = await request.json();
    const parsed = PatchBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const updateData: CompanyUpdatePayload = {
      updatedAt: new Date(),
    };

    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.careersUrl !== undefined) updateData.careersUrl = payload.careersUrl;
    if (payload.logoUrl !== undefined) updateData.logoUrl = normalizeOptionalText(payload.logoUrl);
    if (payload.isActive !== undefined) updateData.isActive = payload.isActive;
    if (payload.platform !== undefined) updateData.platform = payload.platform;
    if (payload.boardToken !== undefined) updateData.boardToken = normalizeOptionalText(payload.boardToken);

    const [existing] = await db
      .select({
        careersUrl: companies.careersUrl,
        platform: companies.platform,
        boardToken: companies.boardToken,
      })
      .from(companies)
      .where(eq(companies.id, id));

    if (!existing) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const existingPlatformParsed = PlatformOverrideSchema.safeParse(existing.platform);
    const effectivePlatform =
      updateData.platform !== undefined
        ? updateData.platform
        : existingPlatformParsed.success
          ? (existingPlatformParsed.data ?? null)
          : null;
    const effectiveCareersUrl = updateData.careersUrl ?? existing.careersUrl;
    const effectiveBoardToken =
      updateData.boardToken !== undefined ? updateData.boardToken : existing.boardToken;

    const boardTokenError = validateBoardTokenRequirement(
      effectivePlatform,
      effectiveCareersUrl,
      effectiveBoardToken
    );

    if (boardTokenError) {
      return NextResponse.json({ error: boardTokenError }, { status: 400 });
    }

    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(eq(companies.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    console.error("Failed to update company:", error);
    return NextResponse.json(
      { error: "Failed to update company" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = await getIdFromParams(params);
    await db.delete(companies).where(eq(companies.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return NextResponse.json({ error: "Invalid company id" }, { status: 400 });
    }

    console.error("Failed to delete company:", error);
    return NextResponse.json(
      { error: "Failed to delete company" },
      { status: 500 }
    );
  }
}
