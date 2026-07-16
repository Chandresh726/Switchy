import { NextResponse } from "next/server";

import { getDashboardStats } from "@/lib/application/stats-service";
import { handleApiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getDashboardStats());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch stats", fallbackCode: "stats_fetch_failed" });
  }
}
