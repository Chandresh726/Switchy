import { describe, expect, it } from "vitest";

import {
  isDetailFailuresTolerable,
  resolveListingCompleteness,
} from "@/lib/scraper/platforms/shared/completeness";

describe("resolveListingCompleteness", () => {
  it("marks exact and over-fetched counts complete", () => {
    expect(resolveListingCompleteness(100, 100)).toEqual({ isComplete: true, missing: 0 });
    expect(resolveListingCompleteness(105, 100)).toEqual({ isComplete: true, missing: 0 });
  });

  it("tolerates a handful of missing jobs on large boards", () => {
    // The JPMorgan case: 7326 of 7328 must not fail the board.
    expect(resolveListingCompleteness(7326, 7328)).toEqual({ isComplete: true, missing: 2 });
    expect(resolveListingCompleteness(1999, 2000)).toEqual({ isComplete: true, missing: 1 });
  });

  it("fails boards missing more than the absolute tolerance", () => {
    expect(resolveListingCompleteness(10, 20).isComplete).toBe(false);
    expect(resolveListingCompleteness(0, 100).isComplete).toBe(false);
  });

  it("scales tolerance to 1% on very large boards", () => {
    // 1% of 10k = 100 tolerated; 101 missing is not.
    expect(resolveListingCompleteness(9900, 10000).isComplete).toBe(true);
    expect(resolveListingCompleteness(9899, 10000).isComplete).toBe(false);
  });
});

describe("isDetailFailuresTolerable", () => {
  it("tolerates zero failures and a couple of failures", () => {
    expect(isDetailFailuresTolerable(0, 500)).toBe(true);
    expect(isDetailFailuresTolerable(1, 1)).toBe(true);
    expect(isDetailFailuresTolerable(2, 50)).toBe(true);
  });

  it("rejects failure counts beyond the tolerance", () => {
    expect(isDetailFailuresTolerable(3, 50)).toBe(false);
    expect(isDetailFailuresTolerable(11, 500)).toBe(false);
  });

  it("scales tolerance to 1% on large hydrations", () => {
    expect(isDetailFailuresTolerable(10, 1000)).toBe(true);
    expect(isDetailFailuresTolerable(11, 1000)).toBe(false);
  });
});
