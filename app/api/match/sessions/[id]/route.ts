import { NextResponse } from "next/server";

import { getAIWorkSession, stopAIWorkSession } from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { matchSessionParamsSchema } from "@/lib/api/contracts/runtime";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = matchSessionParamsSchema.parse(await params);
    const session = await getAIWorkSession(id);
    if (!session) {
      throw new NotFoundError("Session not found", "session_not_found");
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
    return handleApiError(error, { request, fallbackMessage: "Failed to read match session", fallbackCode: "match_session_read_failed", headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    assertAppRequest(request);
    const { id } = matchSessionParamsSchema.parse(await params);
    const result = await stopAIWorkSession(id);
    if (!result.exists) {
      throw new NotFoundError("Session not found", "session_not_found");
    }
    return NextResponse.json({
      sessionId: id,
      status: result.status,
      cancellationRequested: result.stopped,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to cancel match session", fallbackCode: "match_session_cancel_failed", headers: NO_STORE_HEADERS });
  }
}
