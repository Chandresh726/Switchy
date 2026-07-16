import { NextRequest, NextResponse } from "next/server";

import {
  assertAppRequest,
  ConflictError,
  handleApiError,
  NotFoundError,
} from "@/lib/api";
import {
  historyOptionalSessionQuerySchema,
  historySessionQuerySchema,
  scrapeHistoryQuerySchema,
} from "@/lib/api/contracts/history";
import { getLocalScrapeQueueService } from "@/lib/scraper";
import { getScrapeHistoryStore } from "@/lib/scraper/history";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    const query = scrapeHistoryQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    const { limit, offset, sessionId } = query;
    const historyStore = getScrapeHistoryStore();

    if (sessionId) {
      const detail = historyStore.getDetail(sessionId);
      if (!detail) {
        throw new NotFoundError("Session not found", "scrape_session_not_found");
      }
      return NextResponse.json(detail, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(historyStore.list({ limit, offset }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch scrape history", fallbackCode: "scrape_history_fetch_failed", headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { sessionId } = historyOptionalSessionQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const deletion = getScrapeHistoryStore().delete(sessionId);
    if (deletion.active) {
      throw new ConflictError(
        "Stop the active scrape before deleting its history",
        "scrape_session_active"
      );
    }
    if (sessionId && deletion.deleted === 0) {
      throw new NotFoundError("Session not found", "scrape_session_not_found");
    }
    return NextResponse.json(
      { success: true, deleted: deletion.deleted },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete scrape history", fallbackCode: "scrape_history_delete_failed", headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { sessionId } = historySessionQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );

    const cancellation = await getLocalScrapeQueueService().cancelSession(sessionId);
    const stopped = cancellation.sessionStopped;

    if (stopped) {
      return NextResponse.json({ success: true, stopped: true }, { headers: NO_STORE_HEADERS });
    }

    const session = getScrapeHistoryStore().getSessionStatus(sessionId);

    if (!session) {
      throw new NotFoundError("Session not found", "scrape_session_not_found");
    }

    return NextResponse.json(
      { success: true, stopped: false, status: session.status },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to stop scrape session", fallbackCode: "scrape_session_stop_failed", headers: NO_STORE_HEADERS });
  }
}
