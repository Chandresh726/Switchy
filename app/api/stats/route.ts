import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { statsQuerySchema } from "@/lib/api/contracts/stats";
import { getDashboardStats } from "@/lib/application/stats-service";

export async function GET(request: Request) {
  try {
    const { days } = statsQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    return NextResponse.json(await getDashboardStats(days));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch stats", fallbackCode: "stats_fetch_failed" });
  }
}
