import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getAIWorkSession, stopAIWorkSession } from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { matchSessionParamsSchema, matchSessionQuerySchema } from "@/lib/api/contracts/runtime";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = matchSessionParamsSchema.parse(await params);
    const { summary } = matchSessionQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const session = await getAIWorkSession(id, summary === "true");
    if (!session) {
      throw new NotFoundError("Session not found", "session_not_found");
    }
    return NextResponse.json({
      revision: createHash("sha256").update(JSON.stringify([session.status, session.jobsCompleted, session.nextAttemptAt, session.waitReason, session.pipeline.revision])).digest("hex"),
      sessionId: session.id,
      status: session.status,
      nextAttemptAt: session.status === "queued" ? session.nextAttemptAt : null,
      waitReason: session.status === "queued" ? session.waitReason : null,
      total: session.jobsTotal ?? 0,
      completed: session.jobsCompleted ?? 0,
      succeeded: session.jobsSucceeded ?? 0,
      failed: session.jobsFailed ?? 0,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      analysis: session.pipeline.analysis,
      matching: session.pipeline.matching,
      jobs: session.pipeline.jobs,
      jobPagination: session.pipeline.jobPagination,
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
