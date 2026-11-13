import { describe, expect, it } from "vitest";

import {
  isPromotedMatch,
} from "@/lib/ai/matcher/promotion";

describe("match promotion policy", () => {
  it("promotes scores of 70 or greater", () => {
    expect(isPromotedMatch({ matchScore: 90 })).toBe(true);
    expect(isPromotedMatch({ matchScore: 70 })).toBe(true);
    expect(isPromotedMatch({ matchScore: 69 })).toBe(false);
    expect(isPromotedMatch({ matchScore: null })).toBe(false);
  });

});
