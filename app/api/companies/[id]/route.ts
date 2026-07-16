import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  assertAppRequest,
  createApiRequestContext,
  handleApiError,
  logApiFailure,
  NotFoundError,
  ValidationError,
} from "@/lib/api";
import {
  companyIdParamsSchema,
  companyPatchBodySchema,
  companyReplaceBodySchema,
  companyPlatformSchema,
} from "@/lib/api/contracts/companies";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { refreshUnmatchedCompanyMappings } from "@/lib/people/sync";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

type CompanyUpdatePayload = {
  name?: string;
  careersUrl?: string;
  logoUrl?: string | null;
  notes?: string | null;
  isActive?: boolean;
  platform?:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workday"
    | "eightfold"
    | "servicenow"
    | "zwayam"
    | "mynexthire"
    | "uber"
    | "google"
    | "atlassian"
    | "rippling"
    | "visa"
    | "nutanix"
    | "custom"
    | null;
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
  const parsed = companyIdParamsSchema.safeParse(resolved);
  if (!parsed.success) {
    throw new Error("Invalid company id");
  }
  return parsed.data.id;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const id = await getIdFromParams(params);

    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, id));

    if (!company) {
      throw new NotFoundError("Company not found", "company_not_found");
    }

    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return handleApiError(new ValidationError("Invalid company id", "invalid_company_id"), { request });
    }

    return handleApiError(error, { request, fallbackMessage: "Failed to fetch company", fallbackCode: "company_fetch_failed" });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const id = await getIdFromParams(params);
    const body = await request.json();
    const parsed = companyReplaceBodySchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        "Invalid request body",
        "invalid_request",
        400,
        parsed.error.flatten()
      );
    }

    const payload = parsed.data;
    const updateData: CompanyUpdatePayload = {
      name: payload.name,
      careersUrl: payload.careersUrl,
      logoUrl: normalizeOptionalText(payload.logoUrl),
      notes: normalizeOptionalText(payload.notes),
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
      throw new ValidationError(boardTokenError, "board_token_required");
    }

    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(eq(companies.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError("Company not found", "company_not_found");
    }

    try {
      await refreshUnmatchedCompanyMappings({
        companyIds: [updated.id],
      });
    } catch (error) {
      logApiFailure(createApiRequestContext(request), "unmatched_mapping_refresh_failed", 500, error);
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return handleApiError(new ValidationError("Invalid company id", "invalid_company_id"), { request });
    }

    return handleApiError(error, { request, fallbackMessage: "Failed to update company", fallbackCode: "company_update_failed" });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const id = await getIdFromParams(params);
    const body = await request.json();
    const parsed = companyPatchBodySchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        "Invalid request body",
        "invalid_request",
        400,
        parsed.error.flatten()
      );
    }

    const payload = parsed.data;
    const updateData: CompanyUpdatePayload = {
      updatedAt: new Date(),
    };

    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.careersUrl !== undefined) updateData.careersUrl = payload.careersUrl;
    if (payload.logoUrl !== undefined) updateData.logoUrl = normalizeOptionalText(payload.logoUrl);
    if (payload.notes !== undefined) updateData.notes = normalizeOptionalText(payload.notes);
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
      throw new NotFoundError("Company not found", "company_not_found");
    }

    const existingPlatformParsed = companyPlatformSchema.nullable().safeParse(existing.platform);
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
      throw new ValidationError(boardTokenError, "board_token_required");
    }

    const [updated] = await db
      .update(companies)
      .set(updateData)
      .where(eq(companies.id, id))
      .returning();

    if (updated && payload.name !== undefined) {
      try {
        await refreshUnmatchedCompanyMappings({
          companyIds: [updated.id],
        });
      } catch (error) {
        logApiFailure(createApiRequestContext(request), "unmatched_mapping_refresh_failed", 500, error);
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return handleApiError(new ValidationError("Invalid company id", "invalid_company_id"), { request });
    }

    return handleApiError(error, { request, fallbackMessage: "Failed to update company", fallbackCode: "company_update_failed" });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const id = await getIdFromParams(params);
    const result = await getLocalDataMaintenanceService().deleteCompanies([id]);
    if (result.deletedCompanies === 0) {
      throw new NotFoundError("Company not found", "company_not_found");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid company id") {
      return handleApiError(new ValidationError("Invalid company id", "invalid_company_id"), { request });
    }

    return handleApiError(error, { request, fallbackMessage: "Failed to delete company", fallbackCode: "company_delete_failed" });
  }
}
