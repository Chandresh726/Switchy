import { describe, expect, it, vi } from "vitest";

import { consumeAIContentStream } from "@/lib/api/clients/ai";
import { APIClientError } from "@/lib/api/errors";

const content = {
  id: 1,
  jobId: 8,
  type: "cover_letter" as const,
  content: "Hello",
  settingsSnapshot: null,
  currentVariantId: null,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  history: [],
};

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("AI content stream client", () => {
  it("validates deltas and returns the complete event", async () => {
    const onDelta = vi.fn();
    const response = new Response(
      event("delta", { text: "Hel" })
      + event("delta", { text: "lo" })
      + event("complete", { content, runId: "run-1" })
    );

    await expect(consumeAIContentStream(response, onDelta)).resolves.toEqual({
      content,
      runId: "run-1",
    });
    expect(onDelta.mock.calls).toEqual([["Hel"], ["lo"]]);
  });

  it("rejects a malformed event payload", async () => {
    const response = new Response(event("delta", { text: 42 }));
    await expect(consumeAIContentStream(response, vi.fn())).rejects.toThrow();
  });

  it("preserves a structured stream error", async () => {
    const response = new Response(event("error", {
      code: "provider_failed",
      message: "Provider failed",
      requestId: "req-stream",
    }));

    const error = await consumeAIContentStream(response, vi.fn()).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(APIClientError);
    expect(error).toMatchObject({
      code: "provider_failed",
      message: "Provider failed",
      requestId: "req-stream",
    });
  });

  it("rejects a stream that closes before completion", async () => {
    const response = new Response(event("delta", { text: "partial" }));
    await expect(consumeAIContentStream(response, vi.fn())).rejects.toThrow(
      "Generation stream ended before completion"
    );
  });

  it("propagates stream cancellation", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.error(new DOMException("Cancelled", "AbortError"));
      },
    }));

    await expect(consumeAIContentStream(response, vi.fn())).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects a missing streaming body", async () => {
    const response = { body: null } as Response;
    await expect(consumeAIContentStream(response, vi.fn())).rejects.toThrow(
      "Streaming response is unavailable"
    );
  });
});
