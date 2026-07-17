import {
  historyDetailQuerySchema,
  historyIdParamsSchema,
  historyQuerySchema,
  historyMutationResponseSchema,
  matchHistoryDetailResponseSchema,
  matchHistoryListResponseSchema,
  scrapeHistoryQuerySchema,
  scrapeHistoryListResponseSchema,
  scrapeHistoryDetailResponseSchema,
} from "@/lib/api/contracts/history";
import type { z } from "zod";

import { appendQuery, apiCommand, apiRequest, serializePathParam, serializeQuery } from "../client";

const historyPath = (id: string) => serializePathParam(historyIdParamsSchema, { id });
export type HistoryQueryInput = Partial<z.output<typeof historyQuerySchema>>;
export type ScrapeHistoryQueryInput = Partial<z.output<typeof scrapeHistoryQuerySchema>>;
export type HistoryDetailQueryInput = Partial<z.output<typeof historyDetailQuerySchema>>;

export const getMatchHistoryList = (params: HistoryQueryInput = {}) => apiRequest(appendQuery("/api/match-history", serializeQuery(historyQuerySchema, params)), { method: "GET", cache: "no-store" }, matchHistoryListResponseSchema, "Failed to fetch match history");
export const getMatchHistoryDetail = (sessionId: string, params: HistoryDetailQueryInput = {}) => apiRequest(appendQuery(`/api/match-history/${historyPath(sessionId)}`, serializeQuery(historyDetailQuerySchema, params)), { method: "GET", cache: "no-store" }, matchHistoryDetailResponseSchema, "Failed to fetch match history");
export const deleteMatchHistorySession = (sessionId: string) => apiCommand(`/api/match-history/${historyPath(sessionId)}`, "DELETE", historyMutationResponseSchema, "Failed to delete match session");
export const cancelMatchHistorySession = (sessionId: string) => apiCommand(`/api/match-history/${historyPath(sessionId)}/cancel`, "POST", historyMutationResponseSchema, "Failed to stop match session");
export const clearMatchHistory = () => apiCommand("/api/maintenance/match-history/clear", "POST", historyMutationResponseSchema, "Failed to clear match history");
export const getScrapeHistoryList = (params: ScrapeHistoryQueryInput = {}) => apiRequest(appendQuery("/api/scrape-history", serializeQuery(scrapeHistoryQuerySchema, params)), { method: "GET", cache: "no-store" }, scrapeHistoryListResponseSchema, "Failed to fetch scrape history");
export const getScrapeHistoryDetail = (sessionId: string, params: HistoryDetailQueryInput = {}) => apiRequest(appendQuery(`/api/scrape-history/${historyPath(sessionId)}`, serializeQuery(historyDetailQuerySchema, params)), { method: "GET", cache: "no-store" }, scrapeHistoryDetailResponseSchema, "Failed to fetch scrape history");
export const deleteScrapeHistorySession = (sessionId: string) => apiCommand(`/api/scrape-history/${historyPath(sessionId)}`, "DELETE", historyMutationResponseSchema, "Failed to delete scrape session");
export const cancelScrapeHistorySession = (sessionId: string) => apiCommand(`/api/scrape-history/${historyPath(sessionId)}/cancel`, "POST", historyMutationResponseSchema, "Failed to stop scrape session");
export const clearScrapeHistory = () => apiCommand("/api/maintenance/scrape-history/clear", "POST", historyMutationResponseSchema, "Failed to clear scrape history");
