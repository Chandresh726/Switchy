import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AIContentPostBodySchema, AIContentQuerySchema } from "@/lib/ai/contracts";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";
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
    return handleAIAPIError(error, "Failed to get content", "ai_content_get_failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = AIContentPostBodySchema.parse(await request.json());
    const content = await generateContent({
      jobId: body.jobId,
      type: body.type,
      userPrompt: body.userPrompt,
    });

    return NextResponse.json({ content });
  } catch (error) {
    return handleAIAPIError(error, "Failed to generate content", "ai_content_generate_failed");
  }
}

export async function DELETE() {
  try {
    const result = await clearAllGeneratedContent();
    return NextResponse.json(result);
  } catch (error) {
    return handleAIAPIError(error, "Failed to delete AI generated content", "ai_content_delete_all_failed");
  }
}
