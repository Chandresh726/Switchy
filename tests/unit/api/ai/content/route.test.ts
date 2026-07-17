import type { NextRequest } from "next/server";

import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIError } from "@/lib/ai/shared/errors";
import { ValidationError } from "@/lib/api";

const APP_HEADERS = {
  "Content-Type": "application/json",
  origin: "http://localhost",
  "x-switchy-request": "true",
};

const mocks = vi.hoisted(() => ({
  getContentByJobAndType: vi.fn(),
  generateContent: vi.fn(),
  clearAllGeneratedContent: vi.fn(),
}));

vi.mock("@/lib/ai/writing/content-service", () => ({
  getContentByJobAndType: mocks.getContentByJobAndType,
  generateContent: mocks.generateContent,
  clearAllGeneratedContent: mocks.clearAllGeneratedContent,
}));

import { DELETE, GET, POST } from "@/app/api/ai/content/route";

describe("POST /api/ai/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with typed code for invalid request payload", async () => {
    const request = new Request("http://localhost/api/ai/content", {
      method: "POST",
      headers: APP_HEADERS,
      body: JSON.stringify({ jobId: "bad", type: "invalid-type" }),
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("accepts recruiter follow-up payloads", async () => {
    mocks.generateContent.mockResolvedValue({
      id: 11,
      jobId: 42,
      type: "recruiter_follow_up",
      content: "Hi {{connection_first_name}}, I applied and would value a quick review.",
      settingsSnapshot: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    });

    const request = new Request("http://localhost/api/ai/content", {
      method: "POST",
      headers: APP_HEADERS,
      body: JSON.stringify({ jobId: 42, type: "recruiter_follow_up" }),
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.content.type).toBe("recruiter_follow_up");
    expect(mocks.generateContent).toHaveBeenCalledWith({
      jobId: 42,
      type: "recruiter_follow_up",
      userPrompt: undefined,
      parentVariantId: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("returns existing content when query is valid", async () => {
    mocks.getContentByJobAndType.mockResolvedValue({
      id: 1,
      jobId: 42,
      type: "cover_letter",
      content: "hello",
      settingsSnapshot: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    });

    const request = new Request("http://localhost/api/ai/content?jobId=42&type=cover_letter");
    const response = await GET(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.content.content).toBe("hello");
  });

  it("accepts recruiter follow-up type in query params", async () => {
    mocks.getContentByJobAndType.mockResolvedValue(null);

    const request = new Request(
      "http://localhost/api/ai/content?jobId=42&type=recruiter_follow_up"
    );
    const response = await GET(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ exists: false, content: null });
    expect(mocks.getContentByJobAndType).toHaveBeenCalledWith(42, "recruiter_follow_up");
  });

  it("maps delete failures to typed internal error payload", async () => {
    mocks.clearAllGeneratedContent.mockRejectedValue(new Error("boom"));

    const response = await DELETE(new Request("http://localhost/api/ai/content", {
      headers: {
        origin: "http://localhost",
        "x-switchy-request": "true",
      },
    }) as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to delete AI generated content",
      code: "ai_content_delete_all_failed",
    });
  });

  it("sanitizes synchronous provider failures", async () => {
    mocks.generateContent.mockRejectedValue(new APICallError({
      message: "Provider exposed SENTINEL_WRITING_EVIDENCE",
      url: "https://provider.invalid/generate",
      requestBodyValues: { prompt: "SENTINEL_WRITING_EVIDENCE" },
      statusCode: 503,
      responseHeaders: {},
      responseBody: "SENTINEL_PROVIDER_BODY",
      isRetryable: true,
    }));
    const request = new Request("http://localhost/api/ai/content", {
      method: "POST",
      headers: APP_HEADERS,
      body: JSON.stringify({ jobId: 42, type: "cover_letter" }),
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "The AI provider could not complete the request.",
      code: "generation_failed",
    });
    expect(JSON.stringify(body)).not.toContain("SENTINEL_WRITING_EVIDENCE");
    expect(JSON.stringify(body)).not.toContain("SENTINEL_PROVIDER_BODY");
  });

  it("preserves the safe writing quality-gate message", async () => {
    mocks.generateContent.mockRejectedValue(new AIError({
      type: "quality_gate",
      message: "Generated content quality was too low. Please try again.",
      retryable: false,
    }));
    const request = new Request("http://localhost/api/ai/content", {
      method: "POST",
      headers: APP_HEADERS,
      body: JSON.stringify({ jobId: 42, type: "cover_letter" }),
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      error: "Generated content quality was too low. Please try again.",
      code: "quality_gate_failed",
    });
  });

  it("maps ValidationError to a 400 payload", async () => {
    mocks.generateContent.mockRejectedValue(
      new ValidationError(
        "Recruiter follow-up is only available for applied jobs.",
        "invalid_request",
        400
      )
    );

    const request = new Request("http://localhost/api/ai/content", {
      method: "POST",
      headers: APP_HEADERS,
      body: JSON.stringify({ jobId: 1458, type: "recruiter_follow_up" }),
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Recruiter follow-up is only available for applied jobs.",
      code: "invalid_request",
    });
  });
});
