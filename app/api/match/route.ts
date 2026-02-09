import { NextRequest, NextResponse } from "next/server";
import { calculateJobMatch, batchCalculateJobMatches } from "@/lib/ai/matcher";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, jobIds } = body;

    // Single job match
    if (jobId) {
      const result = await calculateJobMatch(jobId);
      return NextResponse.json(result);
    }

    // Batch job matching
    if (jobIds && Array.isArray(jobIds)) {
      const results = await batchCalculateJobMatches(jobIds);

      // Convert Map to object for JSON response
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
          total: jobIds.length,
          successful: Array.from(results.values()).filter(
            (r) => !(r instanceof Error)
          ).length,
        },
      });
    }

    return NextResponse.json(
      { error: "jobId or jobIds is required" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to calculate match:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to calculate match" },
      { status: 500 }
    );
  }
}
