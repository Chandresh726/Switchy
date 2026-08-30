import type { z } from "zod";

import {
  historyDetailQuerySchema,
  historyIdParamsSchema,
  historyQuerySchema,
  historyMutationResponseSchema,
  matchHistoryDetailResponseSchema,
  matchHistoryListResponseSchema,
  resumeHistoryDetailResponseSchema,
  resumeHistoryIdParamsSchema,
  resumeHistoryQuerySchema,
  resumeHistoryListResponseSchema,
  scrapeHistoryDetailQuerySchema,
  scrapeHistoryQuerySchema,
  scrapeHistoryListResponseSchema,
  scrapeHistoryDetailResponseSchema,
} from "@/lib/api/contracts/history";

import { appendQuery, apiCommand, apiRequest, serializePathParam, serializeQuery } from "../client";

const historyPath = (id: string) => serializePathParam(historyIdParamsSchema, { id });
const resumeHistoryPath = (id: string) => serializePathParam(
  resumeHistoryIdParamsSchema,
  { id }
);
export type HistoryQueryInput = Partial<z.output<typeof historyQuerySchema>>;
export type ScrapeHistoryQueryInput = Partial<z.output<typeof scrapeHistoryQuerySchema>>;
export type HistoryDetailQueryInput = Partial<z.output<typeof historyDetailQuerySchema>>;
export type ScrapeHistoryDetailQueryInput = Partial<z.output<typeof scrapeHistoryDetailQuerySchema>>;
export type ResumeHistoryQueryInput = Partial<z.output<typeof resumeHistoryQuerySchema>>;

export const getMatchHistoryList = (params: HistoryQueryInput = {}) => apiRequest(appendQuery("/api/match-history", serializeQuery(historyQuerySchema, params)), { method: "GET", cache: "no-store" }, matchHistoryListResponseSchema, "Failed to fetch match history");
export const getMatchHistoryDetail = (sessionId: string, params: HistoryDetailQueryInput = {}) => apiRequest(appendQuery(`/api/match-history/${historyPath(sessionId)}`, serializeQuery(historyDetailQuerySchema, params)), { method: "GET", cache: "no-store" }, matchHistoryDetailResponseSchema, "Failed to fetch match history");
export const deleteMatchHistorySession = (sessionId: string) => apiCommand(`/api/match-history/${historyPath(sessionId)}`, "DELETE", historyMutationResponseSchema, "Failed to delete match session");
export const cancelMatchHistorySession = (sessionId: string) => apiCommand(`/api/match-history/${historyPath(sessionId)}/cancel`, "POST", historyMutationResponseSchema, "Failed to stop match session");
export const clearMatchHistory = () => apiCommand("/api/maintenance/match-history/clear", "POST", historyMutationResponseSchema, "Failed to clear match history");
export const getScrapeHistoryList = (params: ScrapeHistoryQueryInput = {}) => apiRequest(appendQuery("/api/scrape-history", serializeQuery(scrapeHistoryQuerySchema, params)), { method: "GET", cache: "no-store" }, scrapeHistoryListResponseSchema, "Failed to fetch scrape history");
export const getScrapeHistoryDetail = (sessionId: string, params: ScrapeHistoryDetailQueryInput = {}) => apiRequest(appendQuery(`/api/scrape-history/${historyPath(sessionId)}`, serializeQuery(scrapeHistoryDetailQuerySchema, params)), { method: "GET", cache: "no-store" }, scrapeHistoryDetailResponseSchema, "Failed to fetch scrape history");
export const deleteScrapeHistorySession = (sessionId: string) => apiCommand(`/api/scrape-history/${historyPath(sessionId)}`, "DELETE", historyMutationResponseSchema, "Failed to delete scrape session");
export const cancelScrapeHistorySession = (sessionId: string) => apiCommand(`/api/scrape-history/${historyPath(sessionId)}/cancel`, "POST", historyMutationResponseSchema, "Failed to stop scrape session");
export const clearScrapeHistory = () => apiCommand("/api/maintenance/scrape-history/clear", "POST", historyMutationResponseSchema, "Failed to clear scrape history");
export const getResumeHistoryList = (params: ResumeHistoryQueryInput = {}) => apiRequest(appendQuery("/api/resume-history", serializeQuery(resumeHistoryQuerySchema, params)), { method: "GET", cache: "no-store" }, resumeHistoryListResponseSchema, "Failed to fetch resume parse history");
export const getResumeHistoryDetail = (entryId: string) => apiRequest(`/api/resume-history/${resumeHistoryPath(entryId)}`, { method: "GET", cache: "no-store" }, resumeHistoryDetailResponseSchema, "Failed to fetch resume parse details");
