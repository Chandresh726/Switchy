import { describe, expect, it } from "vitest";

import {
  countPromotedMatchRows,
  isPromotedMatch,
} from "@/lib/ai/matcher/promotion";

describe("match promotion policy", () => {
  it("promotes scores of 70 or greater", () => {
    expect(isPromotedMatch({ matchScore: 90 })).toBe(true);
    expect(isPromotedMatch({ matchScore: 70 })).toBe(true);
    expect(isPromotedMatch({ matchScore: 69 })).toBe(false);
    expect(isPromotedMatch({ matchScore: null })).toBe(false);
  });

  it("counts current scores before legacy scores", () => {
    const rows = [
      ...Array.from({ length: 55 }, () => ({ score: 30, legacyScore: 90 })),
      ...Array.from({ length: 5 }, () => ({ score: 75, legacyScore: null })),
      { score: null, legacyScore: 72 },
    ];
    expect(countPromotedMatchRows(rows)).toBe(6);
  });
});
