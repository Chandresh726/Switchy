import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest } from "@/lib/api";
import { getLocalScrapeQueueService } from "@/lib/scraper";
import { getScrapeHistoryStore } from "@/lib/scraper/history";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");
    const sessionId = searchParams.get("sessionId");
    const historyStore = getScrapeHistoryStore();

    if (sessionId) {
      const detail = historyStore.getDetail(sessionId);
      if (!detail) {
        return NextResponse.json({ error: "Session not found" }, { status: 404, headers: NO_STORE_HEADERS });
      }
      return NextResponse.json(detail, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(historyStore.list({ limit, offset }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Failed to fetch scrape history:", error);
    return NextResponse.json(
      { error: "Failed to fetch scrape history" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    const deletion = getScrapeHistoryStore().delete(sessionId ?? undefined);
    if (deletion.active) {
      return NextResponse.json(
        { error: "Stop the active scrape before deleting its history" },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      { success: true, deleted: deletion.deleted },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Failed to delete scrape history:", error);
    return NextResponse.json(
      { error: "Failed to delete scrape history" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const cancellation = await getLocalScrapeQueueService().cancelSession(sessionId);
    const stopped = cancellation.sessionStopped;

    if (stopped) {
      return NextResponse.json({ success: true, stopped: true }, { headers: NO_STORE_HEADERS });
    }

    const session = getScrapeHistoryStore().getSessionStatus(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: true, stopped: false, status: session.status },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Failed to stop scrape session:", error);
    return NextResponse.json(
      { error: "Failed to stop scrape session" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
