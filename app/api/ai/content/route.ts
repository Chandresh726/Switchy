import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AIContentPostBodySchema, AIContentQuerySchema } from "@/lib/ai/contracts";
import { assertAppRequest, handleApiError } from "@/lib/api";
import {
  clearAllGeneratedContent,
  generateContent,
  getContentByJobAndType,
} from "@/lib/ai/writing/content-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = AIContentQuerySchema.parse({
      jobId: searchParams.get("jobId"),
      type: searchParams.get("type"),
    });

    const content = await getContentByJobAndType(query.jobId, query.type);

    if (!content) {
      return NextResponse.json({ exists: false, content: null }, { status: 200 });
    }

    return NextResponse.json({ exists: true, content });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to get content", fallbackCode: "ai_content_get_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = AIContentPostBodySchema.parse(await request.json());
    const content = await generateContent({
      jobId: body.jobId,
      type: body.type,
      userPrompt: body.userPrompt,
      parentVariantId: body.parentVariantId,
      signal: request.signal,
    });

    return NextResponse.json({
      content,
      runId: content.history.at(-1)?.aiRunId ?? null,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to generate content", fallbackCode: "ai_content_generate_failed" });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const result = await clearAllGeneratedContent();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete AI generated content", fallbackCode: "ai_content_delete_all_failed" });
  }
}
