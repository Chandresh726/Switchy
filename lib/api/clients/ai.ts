import {
  AIContentPatchBodySchema,
  AIContentPostBodySchema,
  AIContentQuerySchema,
  AIContentVariantSignalSchema,
} from "@/lib/ai/contracts";
import {
  aiContentEnvelopeSchema,
  aiContentWriteResponseSchema,
  aiHistoryResponseSchema,
  aiStreamCompleteSchema,
  aiStreamDeltaSchema,
  aiStreamErrorSchema,
  aiUsageQuerySchema,
  aiUsageResponseSchema,
} from "@/lib/api/contracts/ai";
import { successSchema } from "@/lib/api/contracts/common";
import { clearAiContentResponseSchema } from "@/lib/api/contracts/settings";
import { numericIdParamsSchema } from "@/lib/api/contracts/matching";
import { APIClientError } from "@/lib/api/errors";
import type { z } from "zod";

import { appendQuery, apiCommand, apiJsonMutation, apiRequest, apiStreamRequest, serializePathParam, serializeQuery } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

const contentPath = (id: number) => serializePathParam(numericIdParamsSchema, { id });

export const getAIHistory = () => apiRequest("/api/ai/history", { method: "GET", cache: "no-store" }, aiHistoryResponseSchema, "Failed to fetch AI history");
export const clearAIHistory = () => apiCommand("/api/ai/history", "DELETE", successSchema, "Failed to clear AI history");
export const clearAllAIContent = () => apiCommand("/api/ai/content", "DELETE", clearAiContentResponseSchema, "Failed to clear AI content");
export const deleteAIContent = (id: number) => apiCommand(`/api/ai/content/${contentPath(id)}`, "DELETE", successSchema, "Failed to delete AI content");
export const getAIContent = (jobId: number, type: z.output<typeof AIContentQuerySchema>["type"]) => apiRequest(appendQuery("/api/ai/content", serializeQuery(AIContentQuerySchema, { jobId, type })), { method: "GET" }, aiContentEnvelopeSchema, "Failed to load saved content");
export const saveAIContent = (id: number, body: z.output<typeof AIContentPatchBodySchema>) => apiJsonMutation(`/api/ai/content/${contentPath(id)}`, "PATCH", AIContentPatchBodySchema, body, aiContentWriteResponseSchema, "Failed to save AI content");
export const recordAIVariantSignal = (variantId: number, action: z.output<typeof AIContentVariantSignalSchema>["action"]) => apiJsonMutation(`/api/ai/content/variants/${contentPath(variantId)}`, "PATCH", AIContentVariantSignalSchema, { action }, successSchema, `Failed to record ${action} signal`);
export const getAIUsage = (days: 7 | 30) => apiRequest(appendQuery("/api/ai/usage", serializeQuery(aiUsageQuerySchema, { days: String(days) as "7" | "30" })), { method: "GET", cache: "no-store" }, aiUsageResponseSchema, "Failed to fetch AI usage");
export const openAIContentStream = (body: z.output<typeof AIContentPostBodySchema>, signal: AbortSignal) => apiStreamRequest("/api/ai/content/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  signal,
  body: JSON.stringify(AIContentPostBodySchema.parse(body)),
}, "Failed to generate content");

export async function consumeAIContentStream(
  response: Response,
  onDelta: (text: string) => void
): Promise<ReturnType<typeof aiStreamCompleteSchema.parse>> {
  if (!response.body) throw new Error("Streaming response is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: ReturnType<typeof aiStreamCompleteSchema.parse> | null = null;

  const processFrame = (frame: string) => {
    let event = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!event || dataLines.length === 0) return;
    const data: unknown = JSON.parse(dataLines.join("\n"));
    if (event === "delta") {
      onDelta(aiStreamDeltaSchema.parse(data).text);
    } else if (event === "complete") {
      complete = aiStreamCompleteSchema.parse(data);
    } else if (event === "error") {
      const streamError = aiStreamErrorSchema.parse(data);
      throw new APIClientError(
        streamError.message,
        500,
        streamError.code,
        undefined,
        streamError.requestId
      );
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      processFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) processFrame(buffer);
  if (!complete) throw new Error("Generation stream ended before completion");
  return complete;
}
