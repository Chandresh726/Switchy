import { NextRequest, NextResponse } from "next/server";

import { MatchRouteBodySchema } from "@/lib/ai/contracts";
import {
  getMatchPresentationsForJobIds,
  matchBulk,
  matchSingle,
} from "@/lib/ai/matcher";
import { assertAppRequest } from "@/lib/api";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = MatchRouteBodySchema.parse(await request.json());

    if ("jobId" in body) {
      const result = await matchSingle(body.jobId, request.signal);
      const presentation = (await getMatchPresentationsForJobIds([body.jobId]))
        .get(body.jobId);
      return NextResponse.json({
        ...result,
        matchResultId: presentation?.matchResultId ?? null,
        matchConfidence: presentation?.matchConfidence ?? null,
        matchBreakdown: presentation?.matchBreakdown ?? null,
        matchStale: presentation?.matchStale ?? false,
        scoringPolicyVersion: presentation?.scoringPolicyVersion ?? null,
      });
    }

    const results = await matchBulk(body.jobIds, undefined, request.signal);
    const presentations = await getMatchPresentationsForJobIds(body.jobIds);
    const response: Record<string, unknown> = {};

    for (const [id, result] of results) {
      if (result instanceof Error) {
        response[id] = { error: result.message };
      } else {
        const presentation = presentations.get(id);
        response[id] = {
          ...result,
          matchResultId: presentation?.matchResultId ?? null,
          matchConfidence: presentation?.matchConfidence ?? null,
          matchBreakdown: presentation?.matchBreakdown ?? null,
          matchStale: presentation?.matchStale ?? false,
          scoringPolicyVersion: presentation?.scoringPolicyVersion ?? null,
        };
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
