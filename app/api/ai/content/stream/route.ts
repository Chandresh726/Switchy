import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AIContentPostBodySchema } from "@/lib/ai/contracts";
import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { assertAppRequest } from "@/lib/api";
import { APIValidationError } from "@/lib/api/ai-error-handler";
import { streamGeneratedContent } from "@/lib/ai/writing/content-service";

const encoder = new TextEncoder();

function sseEvent(event: "delta" | "complete" | "error", data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function safeStreamError(error: unknown): { code: string; message: string } {
  if (error instanceof z.ZodError) {
    return { code: "invalid_request", message: "Invalid request payload" };
  }
  if (error instanceof APIValidationError) {
    return { code: error.code, message: error.message };
  }
  const sanitized = sanitizeAIError(error);
  return { code: sanitized.code, message: sanitized.message };
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const body = AIContentPostBodySchema.parse(await request.json());
    const streamAbortController = new AbortController();
    const signal = AbortSignal.any([request.signal, streamAbortController.signal]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            const content = await streamGeneratedContent({
              jobId: body.jobId,
              type: body.type,
              userPrompt: body.userPrompt,
              parentVariantId: body.parentVariantId,
              signal,
            }, (delta) => {
              controller.enqueue(sseEvent("delta", { text: delta }));
            });
            controller.enqueue(sseEvent("complete", {
              content,
              runId: content.history.at(-1)?.aiRunId ?? null,
            }));
          } catch (error) {
            if (!signal.aborted) {
              controller.enqueue(sseEvent("error", safeStreamError(error)));
            }
          } finally {
            try {
              controller.close();
            } catch {
              // The client may have closed the stream after aborting the request.
            }
          }
        })();
      },
      cancel() {
        streamAbortController.abort(new DOMException("Writing stream cancelled", "AbortError"));
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const safe = safeStreamError(error);
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: 400 });
  }
}
