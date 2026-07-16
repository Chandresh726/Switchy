import { NextRequest, NextResponse } from "next/server";

import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import {
  requireProviderById,
} from "@/lib/ai/providers/provider-service";
import { handleApiError, ValidationError } from "@/lib/api";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const STRICT_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function resolveCallerOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function assertSameOrigin(request: NextRequest): void {
  const callerOrigin = resolveCallerOrigin(request);
  const appOrigin = request.nextUrl.origin;

  if (!callerOrigin || callerOrigin !== appOrigin) {
    throw new ValidationError(
      "Cross-origin requests are not allowed",
      "cross_origin_forbidden",
      403
    );
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    assertSameOrigin(request);

    const parsedParams = ProviderRouteParamsSchema.parse(await params);
    const provider = await requireProviderById(parsedParams.id);

    return NextResponse.json(
      {
        id: provider.id,
        provider: provider.provider,
        isActive: provider.isActive,
        isDefault: provider.isDefault,
        hasApiKey: !!provider.apiKey,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      },
      { headers: STRICT_NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to fetch provider",
      fallbackCode: "provider_api_key_fetch_failed",
      headers: STRICT_NO_STORE_HEADERS,
    });
  }
}
