import { NextRequest, NextResponse } from "next/server";

import { getLocalCLIStatus } from "@/lib/ai/local-cli/service";
import { handleApiError } from "@/lib/api";
import { localCLIStatusQuerySchema } from "@/lib/api/contracts/providers";

export async function GET(request: NextRequest) {
  try {
    const { provider } = localCLIStatusQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    return NextResponse.json(await getLocalCLIStatus(provider, { forceRefresh: true }));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to check local CLI", fallbackCode: "provider_validation_failed" });
  }
}
