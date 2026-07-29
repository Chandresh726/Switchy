import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type { AIContentType } from "@/lib/ai/contracts";
import type * as databaseSchema from "@/lib/db/schema";
import {
  aiGeneratedContent,
  aiGenerationEvents,
  aiGenerationHistory,
} from "@/lib/db/schema";

const MAX_EDIT_DISTANCE_CELLS = 25_000_000;

function calculateEditDistance(leftInput: string, rightInput: string): {
  distance: number | null;
  ratio: number | null;
} {
  let left = leftInput;
  let right = rightInput;
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  left = left.slice(prefix);
  right = right.slice(prefix);
  let suffix = 0;
  while (
    suffix < left.length &&
    suffix < right.length &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix++;
  if (suffix > 0) {
    left = left.slice(0, -suffix);
    right = right.slice(0, -suffix);
  }
  if (left.length * right.length > MAX_EDIT_DISTANCE_CELLS) {
    return { distance: null, ratio: null };
  }
  if (left.length > right.length) [left, right] = [right, left];
  let previous = Uint32Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let row = 1; row <= right.length; row++) {
    const current = new Uint32Array(left.length + 1);
    current[0] = row;
    for (let column = 1; column <= left.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + Number(left[column - 1] !== right[row - 1])
      );
    }
    previous = current;
  }
  const distance = previous[left.length] ?? 0;
  return {
    distance,
    ratio: Number((distance / Math.max(leftInput.length, rightInput.length, 1)).toFixed(4)),
  };
}

export interface PersistWritingVariantInput {
  jobId: number;
  type: AIContentType;
  text: string;
  settingsSnapshot: string | null;
  userPrompt: string | null;
  parentVariant: typeof aiGenerationHistory.$inferSelect | null;
  aiRunId: string | null;
  source: "generated" | "manual_edit";
}

export function persistWritingVariant(
  database: BetterSQLite3Database<typeof databaseSchema>,
  input: PersistWritingVariantInput
): {
  content: typeof aiGeneratedContent.$inferSelect;
  history: Array<typeof aiGenerationHistory.$inferSelect>;
} {
  return database.transaction((tx) => {
    const now = new Date();
    let content = tx.select().from(aiGeneratedContent).where(and(
      eq(aiGeneratedContent.jobId, input.jobId),
      eq(aiGeneratedContent.type, input.type)
    )).limit(1).get();
    if (content) {
      tx.update(aiGeneratedContent).set({
        content: input.text,
        settingsSnapshot: input.settingsSnapshot ?? content.settingsSnapshot,
        updatedAt: now,
      }).where(eq(aiGeneratedContent.id, content.id)).run();
    } else {
      content = tx.insert(aiGeneratedContent).values({
        jobId: input.jobId,
        type: input.type,
        content: input.text,
        settingsSnapshot: input.settingsSnapshot,
        createdAt: now,
        updatedAt: now,
      }).returning().get();
    }
    if (!content) throw new Error("Failed to create writing content");
    const edit = input.parentVariant
      ? calculateEditDistance(input.parentVariant.variant, input.text)
      : { distance: null, ratio: null };
    const insertedVariant = tx.insert(aiGenerationHistory).values({
      contentId: content.id,
      variant: input.text,
      userPrompt: input.userPrompt,
      parentVariantId: input.parentVariant?.id ?? null,
      aiRunId: input.aiRunId,
      source: input.source,
      selectedAt: now,
      editDistance: edit.distance,
      editDistanceRatio: edit.ratio,
      createdAt: now,
    }).returning({ id: aiGenerationHistory.id }).get();
    tx.update(aiGeneratedContent).set({
      currentVariantId: insertedVariant.id,
    }).where(eq(aiGeneratedContent.id, content.id)).run();
    tx.insert(aiGenerationEvents).values({
      variantId: insertedVariant.id,
      action: "selected",
      source: "generated",
      createdAt: now,
    }).run();
    const savedContent = tx.select().from(aiGeneratedContent)
      .where(eq(aiGeneratedContent.id, content.id)).get();
    if (!savedContent) throw new Error("Failed to read persisted writing content");
    const history = tx.select().from(aiGenerationHistory)
      .where(eq(aiGenerationHistory.contentId, content.id))
      .orderBy(aiGenerationHistory.createdAt, aiGenerationHistory.id)
      .all();
    return { content: savedContent, history };
  });
}

export function recordWritingVariantSignal(
  database: BetterSQLite3Database<typeof databaseSchema>,
  variantId: number,
  action: "selected" | "copied" | "discarded",
  source: "initial_load" | "navigation" | "copy" | "discard"
): boolean {
  return database.transaction((tx) => {
    const variant = tx.select({
      contentId: aiGenerationHistory.contentId,
    }).from(aiGenerationHistory)
      .where(eq(aiGenerationHistory.id, variantId))
      .get();
    if (!variant) return false;
    const now = new Date();
    const timestampColumn = action === "selected"
      ? { selectedAt: now }
      : action === "copied"
        ? { copiedAt: now }
        : { discardedAt: now };
    tx.update(aiGenerationHistory)
      .set(timestampColumn)
      .where(eq(aiGenerationHistory.id, variantId))
      .run();
    tx.insert(aiGenerationEvents).values({
      variantId,
      action,
      source,
      createdAt: now,
    }).run();
    if (action === "selected") {
      tx.update(aiGeneratedContent).set({
        currentVariantId: variantId,
        updatedAt: now,
      }).where(eq(aiGeneratedContent.id, variant.contentId)).run();
    } else if (action === "discarded") {
      tx.update(aiGeneratedContent).set({
        currentVariantId: null,
        updatedAt: now,
      }).where(and(
        eq(aiGeneratedContent.id, variant.contentId),
        eq(aiGeneratedContent.currentVariantId, variantId)
      )).run();
    }
    return true;
  });
}
