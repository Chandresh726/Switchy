import { NextResponse } from "next/server";

import { getAIWorkSession, stopAIWorkSession } from "@/lib/ai/work-items";
import { assertAppRequest } from "@/lib/api";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getAIWorkSession((await params).id);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found", code: "session_not_found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      total: session.jobsTotal ?? 0,
      completed: session.jobsCompleted ?? 0,
      succeeded: session.jobsSucceeded ?? 0,
      failed: session.jobsFailed ?? 0,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      analysis: session.pipeline.analysis,
      matching: session.pipeline.matching,
      jobs: session.pipeline.jobs,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Failed to read AI work session:", error);
    return NextResponse.json(
      { error: "Failed to read match session" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    assertAppRequest(request);
    const { id } = await params;
    const result = await stopAIWorkSession(id);
    if (!result.exists) {
      return NextResponse.json(
        { error: "Session not found", code: "session_not_found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json({
      sessionId: id,
      status: result.status,
      cancellationRequested: result.stopped,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Failed to cancel AI work session:", error);
    return NextResponse.json(
      { error: "Failed to cancel match session" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
