import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { clearProviderModelsCache } from "@/lib/ai/providers/model-catalog";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { encryptApiKey } from "@/lib/encryption";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const RouteParamsSchema = z.object({
  id: z.string().min(1),
});

const PatchProviderBodySchema = z.object({
  apiKey: z.string().nullable().optional(),
});

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = RouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    const { id } = parsedParams.data;

    const provider = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (provider.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const p = provider[0];
    const status = p.apiKey ? "connected" : "missing_api_key";

    return NextResponse.json({
      id: p.id,
      provider: p.provider,
      isActive: p.isActive,
      isDefault: p.isDefault,
      hasApiKey: !!p.apiKey,
      status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  } catch (error) {
    console.error("Failed to fetch provider:", error);
    return NextResponse.json({ error: "Failed to fetch provider" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = RouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    const { id } = parsedParams.data;

    const parsedBody = PatchProviderBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { apiKey } = parsedBody.data;

    const existing = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const normalizedApiKey = apiKey?.trim();
    const encryptedApiKey = normalizedApiKey ? encryptApiKey(normalizedApiKey) : null;

    await db
      .update(aiProviders)
      .set({
        apiKey: encryptedApiKey,
        updatedAt: new Date(),
      })
      .where(eq(aiProviders.id, id));

    clearProviderModelsCache(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update provider:", error);
    return NextResponse.json({ error: "Failed to update provider" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedParams = RouteParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    const { id } = parsedParams.data;
    
    const existing = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const deletedProvider = existing[0];

    await db.delete(aiProviders).where(eq(aiProviders.id, id));
    clearProviderModelsCache(id);

    if (deletedProvider.isDefault) {
      const remainingProviders = await db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.isActive, true))
        .orderBy(asc(aiProviders.createdAt));

      if (remainingProviders.length > 0) {
        await db
          .update(aiProviders)
          .set({
            isDefault: false,
            updatedAt: new Date(),
          })
          .where(eq(aiProviders.isActive, true));

        await db
          .update(aiProviders)
          .set({
            isDefault: true,
            updatedAt: new Date(),
          })
          .where(eq(aiProviders.id, remainingProviders[0].id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete provider:", error);
    return NextResponse.json({ error: "Failed to delete provider" }, { status: 500 });
  }
}
