import {
  historyMutationResponseSchema,
  matchHistoryDetailResponseSchema,
  matchHistoryListResponseSchema,
  scrapeHistoryListResponseSchema,
  scrapeHistoryDetailResponseSchema,
} from "@/lib/api/contracts/history";

import { apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

export const getMatchHistoryList = (query = "") => apiRequest(`/api/match-history${query ? `?${query}` : ""}`, { method: "GET", cache: "no-store" }, matchHistoryListResponseSchema, "Failed to fetch match history");
export const getMatchHistoryDetail = (sessionId: string) => apiRequest(`/api/match-history?sessionId=${encodeURIComponent(sessionId)}`, { method: "GET", cache: "no-store" }, matchHistoryDetailResponseSchema, "Failed to fetch match history");
export const mutateMatchHistory = (method: "DELETE" | "PATCH", sessionId?: string) => apiRequest(
  `/api/match-history${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
  { method, headers: APP_REQUEST_HEADERS },
  historyMutationResponseSchema,
  method === "DELETE" ? "Failed to delete match history" : "Failed to stop match session"
);
export const getScrapeHistoryList = (query = "") => apiRequest(`/api/scrape-history${query ? `?${query}` : ""}`, { method: "GET", cache: "no-store" }, scrapeHistoryListResponseSchema, "Failed to fetch scrape history");
export const getScrapeHistoryDetail = (sessionId: string) => apiRequest(`/api/scrape-history?sessionId=${encodeURIComponent(sessionId)}`, { method: "GET", cache: "no-store" }, scrapeHistoryDetailResponseSchema, "Failed to fetch scrape history");
export const mutateScrapeHistory = (method: "DELETE" | "PATCH", sessionId?: string) => apiRequest(
  `/api/scrape-history${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
  { method, headers: APP_REQUEST_HEADERS },
  historyMutationResponseSchema,
  method === "DELETE" ? "Failed to delete scrape history" : "Failed to stop scrape session"
);
