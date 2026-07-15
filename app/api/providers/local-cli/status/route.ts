import { NextRequest, NextResponse } from "next/server";

import { getLocalCLIStatus } from "@/lib/ai/local-cli/service";
import { isLocalCLIProvider } from "@/lib/ai/providers/types";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

export async function GET(request: NextRequest) {
  try {
    const provider = request.nextUrl.searchParams.get("provider") ?? "";
    if (!isLocalCLIProvider(provider)) {
      return NextResponse.json(
        { error: "Invalid local CLI provider", code: "invalid_provider" },
        { status: 400 }
      );
    }

    return NextResponse.json(await getLocalCLIStatus(provider, { forceRefresh: true }));
  } catch (error) {
    return handleAIAPIError(error, "Failed to check local CLI", "provider_validation_failed");
  }
}
