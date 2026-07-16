import { describe, expect, it } from "vitest";

import type { HistoryVariant } from "@/lib/ai/writing/types";
import {
  selectAdjacentVariantIndex,
  selectInitialVariantIndex,
} from "@/lib/ai/writing/workspace/variants";

function variant(id: number, discardedAt: string | null): HistoryVariant {
  return {
    id,
    variant: `draft ${id}`,
    userPrompt: null,
    parentVariantId: null,
    aiRunId: null,
    source: "generated",
    selectedAt: null,
    copiedAt: null,
    discardedAt,
    editDistance: null,
    editDistanceRatio: null,
    createdAt: new Date(id).toISOString(),
  };
}

describe("writing variant selection", () => {
  it("selects the newest non-discarded variant by default", () => {
    const history = [variant(1, null), variant(2, null), variant(3, new Date().toISOString())];
    expect(selectInitialVariantIndex(history)).toBe(1);
  });

  it("honors an explicit history link and falls back when all are discarded", () => {
    const history = [variant(1, new Date().toISOString()), variant(2, new Date().toISOString())];
    expect(selectInitialVariantIndex(history, 1)).toBe(0);
    expect(selectInitialVariantIndex(history)).toBe(1);
  });

  it("skips discarded variants during circular navigation", () => {
    const history = [variant(1, null), variant(2, new Date().toISOString()), variant(3, null)];
    expect(selectAdjacentVariantIndex(history, 0, "next")).toBe(2);
    expect(selectAdjacentVariantIndex(history, 2, "prev")).toBe(0);
    expect(selectAdjacentVariantIndex(history, 1, "next")).toBe(0);
  });
});
