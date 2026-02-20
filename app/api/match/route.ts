import { NextRequest, NextResponse } from "next/server";

import { MatchRouteBodySchema } from "@/lib/ai/contracts";
import { matchBulk, matchSingle } from "@/lib/ai/matcher";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

export async function POST(request: NextRequest) {
  try {
    const body = MatchRouteBodySchema.parse(await request.json());

    if ("jobId" in body) {
      const result = await matchSingle(body.jobId);
      return NextResponse.json(result);
    }

    const results = await matchBulk(body.jobIds);
    const response: Record<string, unknown> = {};

    for (const [id, result] of results) {
      if (result instanceof Error) {
        response[id] = { error: result.message };
      } else {
        response[id] = result;
      }
    }

    return NextResponse.json({
      results: response,
      summary: {
        total: body.jobIds.length,
        successful: Array.from(results.values()).filter((item) => !(item instanceof Error)).length,
      },
    });
  } catch (error) {
    return handleAIAPIError(error, "Failed to calculate match", "match_failed");
  }
}
