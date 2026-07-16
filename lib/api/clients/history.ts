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
export const getMatchHistoryDetail = (sessionId: string, logOffset = 0, logLimit = 50, workOffset = 0, workLimit = 50) => apiRequest(`/api/match-history/${encodeURIComponent(sessionId)}?logLimit=${logLimit}&logOffset=${logOffset}&workLimit=${workLimit}&workOffset=${workOffset}`, { method: "GET", cache: "no-store" }, matchHistoryDetailResponseSchema, "Failed to fetch match history");
export const deleteMatchHistorySession = (sessionId: string) => apiRequest(`/api/match-history/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: APP_REQUEST_HEADERS }, historyMutationResponseSchema, "Failed to delete match session");
export const cancelMatchHistorySession = (sessionId: string) => apiRequest(`/api/match-history/${encodeURIComponent(sessionId)}/cancel`, { method: "POST", headers: APP_REQUEST_HEADERS }, historyMutationResponseSchema, "Failed to stop match session");
export const clearMatchHistory = () => apiRequest("/api/maintenance/match-history/clear", { method: "POST", headers: APP_REQUEST_HEADERS }, historyMutationResponseSchema, "Failed to clear match history");
export const getScrapeHistoryList = (query = "") => apiRequest(`/api/scrape-history${query ? `?${query}` : ""}`, { method: "GET", cache: "no-store" }, scrapeHistoryListResponseSchema, "Failed to fetch scrape history");
export const getScrapeHistoryDetail = (sessionId: string, logOffset = 0, logLimit = 50, workOffset = 0, workLimit = 50) => apiRequest(`/api/scrape-history/${encodeURIComponent(sessionId)}?logLimit=${logLimit}&logOffset=${logOffset}&workLimit=${workLimit}&workOffset=${workOffset}`, { method: "GET", cache: "no-store" }, scrapeHistoryDetailResponseSchema, "Failed to fetch scrape history");
export const deleteScrapeHistorySession = (sessionId: string) => apiRequest(`/api/scrape-history/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: APP_REQUEST_HEADERS }, historyMutationResponseSchema, "Failed to delete scrape session");
export const cancelScrapeHistorySession = (sessionId: string) => apiRequest(`/api/scrape-history/${encodeURIComponent(sessionId)}/cancel`, { method: "POST", headers: APP_REQUEST_HEADERS }, historyMutationResponseSchema, "Failed to stop scrape session");
export const clearScrapeHistory = () => apiRequest("/api/maintenance/scrape-history/clear", { method: "POST", headers: APP_REQUEST_HEADERS }, historyMutationResponseSchema, "Failed to clear scrape history");
