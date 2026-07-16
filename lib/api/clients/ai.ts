import {
  aiContentEnvelopeSchema,
  aiContentWriteResponseSchema,
  aiHistoryResponseSchema,
  aiUsageResponseSchema,
} from "@/lib/api/contracts/ai";
import { successSchema } from "@/lib/api/contracts/common";

import { apiRequest, apiStreamRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

const jsonMutation = (method: "PATCH" | "DELETE", body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? APP_REQUEST_HEADERS : { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const getAIHistory = () => apiRequest("/api/ai/history", { method: "GET", cache: "no-store" }, aiHistoryResponseSchema, "Failed to fetch AI history");
export const clearAIHistory = () => apiRequest("/api/ai/history", jsonMutation("DELETE"), successSchema, "Failed to clear AI history");
export const deleteAIContent = (id: number) => apiRequest(`/api/ai/content/${id}`, jsonMutation("DELETE"), successSchema, "Failed to delete AI content");
export const getAIContent = (jobId: number, type: string) => apiRequest(`/api/ai/content?jobId=${jobId}&type=${encodeURIComponent(type)}`, { method: "GET" }, aiContentEnvelopeSchema, "Failed to load saved content");
export const saveAIContent = (id: number, body: Record<string, unknown>) => apiRequest(`/api/ai/content/${id}`, jsonMutation("PATCH", body), aiContentWriteResponseSchema, "Failed to save AI content");
export const recordAIVariantSignal = (variantId: number, action: "selected" | "copied" | "discarded") => apiRequest(`/api/ai/content/variants/${variantId}`, jsonMutation("PATCH", { action }), successSchema, `Failed to record ${action} signal`);
export const getAIUsage = (days: 7 | 30) => apiRequest(`/api/ai/usage?days=${days}`, { method: "GET", cache: "no-store" }, aiUsageResponseSchema, "Failed to fetch AI usage");
export const openAIContentStream = (body: Record<string, unknown>, signal: AbortSignal) => apiStreamRequest("/api/ai/content/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  signal,
  body: JSON.stringify(body),
}, "Failed to generate content");
