import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import {
  assertAppRequest,
  createApiRequestContext,
  handleApiError,
  logApiFailure,
  ValidationError,
} from "@/lib/api";
import { companyCreateBodySchema } from "@/lib/api/contracts/companies";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { refreshUnmatchedCompanyMappings } from "@/lib/people/sync";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

type CompanyInput = typeof companyCreateBodySchema._output;

const MANUAL_BOARD_TOKEN_REQUIRED = new Set(["greenhouse", "lever", "ashby"]);

function normalizeOptionalText(value?: string | null): string | null {
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
        notes: normalizeOptionalText(input.notes),
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
      notes: normalizeOptionalText(input.notes),
      platform: resolvedPlatform,
      boardToken,
      isActive: true,
    })
    .returning();

  return created;
}

export async function GET(request: NextRequest) {
  try {
    const companiesData = await db
      .select()
      .from(companies)
      .orderBy(desc(companies.createdAt));

    return NextResponse.json(companiesData);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch companies", fallbackCode: "companies_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();
    const isBulk = Array.isArray(body);
    const rawItems = isBulk ? body : [body];
    const results = [];

    for (const rawItem of rawItems) {
      const parsed = companyCreateBodySchema.safeParse(rawItem);

      if (!parsed.success) {
        if (!isBulk) {
          throw new ValidationError(
            "Invalid request body",
            "invalid_request",
            400,
            parsed.error.flatten()
          );
        }
        continue;
      }

      const input = parsed.data;
      const detectedFromUrl = detectPlatformFromUrl(input.careersUrl);

      if (shouldRejectMissingBoardToken(input, detectedFromUrl)) {
        if (!isBulk) {
          throw new ValidationError(
            `boardToken is required when manually selecting ${input.platform} platform with a custom URL`,
            "board_token_required"
          );
        }
        continue;
      }

      const result = await upsertCompany(input);
      if (result) {
        results.push(result);
      }
    }

    if (results.length > 0) {
      try {
        await refreshUnmatchedCompanyMappings({
          companyIds: results.map((company) => company.id),
        });
      } catch (error) {
        logApiFailure(createApiRequestContext(request), "unmatched_mapping_refresh_failed", 500, error);
      }
    }

    if (!isBulk) {
      if (results.length === 0) {
        throw new ValidationError(
          "name and careersUrl are required",
          "invalid_company"
        );
      }
      return NextResponse.json(results[0]);
    }

    return NextResponse.json(results);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to create/import companies", fallbackCode: "companies_import_failed" });
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();

    if (!Array.isArray(body)) {
      throw new ValidationError(
        "Expected array of companies",
        "invalid_companies_sync"
      );
    }

    const validated: CompanyInput[] = [];
    for (const item of body) {
      const parsed = companyCreateBodySchema.safeParse(item);
      if (parsed.success) {
        validated.push(parsed.data);
      }
    }

    const incomingUrls = new Set(validated.map((item) => item.careersUrl));
    const touchedCompanyIds: number[] = [];

    for (const item of validated) {
      const detectedFromUrl = detectPlatformFromUrl(item.careersUrl);
      if (shouldRejectMissingBoardToken(item, detectedFromUrl)) {
        console.warn(
          `[Companies Sync] Skipping ${item.name}: boardToken required when manually selecting ${item.platform} platform with a custom URL`
        );
        continue;
      }

      const upserted = await upsertCompany(item);
      if (upserted?.id) {
        touchedCompanyIds.push(upserted.id);
      }
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

    if (touchedCompanyIds.length > 0) {
      try {
        await refreshUnmatchedCompanyMappings({
          companyIds: touchedCompanyIds,
        });
      } catch (error) {
        logApiFailure(createApiRequestContext(request), "unmatched_mapping_refresh_failed", 500, error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to sync companies", fallbackCode: "companies_sync_failed" });
  }
}
