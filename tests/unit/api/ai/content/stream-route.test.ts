import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamGeneratedContent: vi.fn(),
}));

vi.mock("@/lib/ai/writing/content-service", () => ({
  streamGeneratedContent: mocks.streamGeneratedContent,
}));

import { POST } from "@/app/api/ai/content/stream/route";

const HEADERS = {
  "Content-Type": "application/json",
  origin: "http://localhost",
  "x-switchy-request": "true",
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/content/stream", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("POST /api/ai/content/stream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits deltas followed by the persisted content and run id", async () => {
    mocks.streamGeneratedContent.mockImplementation(async (_input, onDelta) => {
      await onDelta("Hello ");
      await onDelta("there");
      return {
        id: 1,
        jobId: 42,
        type: "referral",
        content: "Hello there",
        settingsSnapshot: "{}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [{ aiRunId: "run-42" }],
      };
    });

    const response = await POST(request({ jobId: 42, type: "referral" }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('event: delta\ndata: {"text":"Hello "}');
    expect(body).toContain('event: delta\ndata: {"text":"there"}');
    expect(body).toContain('event: complete\ndata: {"content":');
    expect(body).toContain('"runId":"run-42"');
    expect(body.indexOf("event: complete")).toBeGreaterThan(body.lastIndexOf("event: delta"));
  });

  it("emits a safe error and no complete event when generation fails after a delta", async () => {
    mocks.streamGeneratedContent.mockImplementation(async (_input, onDelta) => {
      await onDelta("partial text");
      throw new Error("provider leaked sk-secret");
    });

    const response = await POST(request({ jobId: 42, type: "cover_letter" }));
    const body = await response.text();

    expect(body).toContain("event: delta");
    expect(body).toContain("event: error");
    expect(body).toContain('"code":"unknown"');
    expect(body).toContain('"requestId":');
    expect(body).not.toContain("event: complete");
    expect(body).not.toContain("sk-secret");
  });

  it("rejects invalid payloads before starting provider work", async () => {
    const response = await POST(request({ jobId: "bad", type: "referral" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "invalid_request" });
    expect(mocks.streamGeneratedContent).not.toHaveBeenCalled();
  });

  it("aborts generation when the response consumer cancels the stream", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    mocks.streamGeneratedContent.mockImplementation(async (input) => {
      started.resolve(input.signal);
      await new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
      });
    });

    const response = await POST(request({ jobId: 42, type: "referral" }));
    const reader = response.body!.getReader();
    const signal = await started.promise;
    await reader.cancel();

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toMatchObject({ name: "AbortError" });
  });
});
