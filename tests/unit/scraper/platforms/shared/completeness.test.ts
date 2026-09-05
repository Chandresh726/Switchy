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
    expect(resolveListingCompleteness(9995, 10000)).toEqual({ isComplete: true, missing: 5 });
  });

  it("stays strict on small boards", () => {
    expect(resolveListingCompleteness(9, 10)).toEqual({ isComplete: true, missing: 1 });
    expect(resolveListingCompleteness(8, 10).isComplete).toBe(false);
    expect(resolveListingCompleteness(5, 10).isComplete).toBe(false);
    expect(resolveListingCompleteness(0, 1).isComplete).toBe(false);
  });

  it("fails boards missing more than the capped tolerance", () => {
    expect(resolveListingCompleteness(10, 20).isComplete).toBe(false);
    expect(resolveListingCompleteness(0, 100).isComplete).toBe(false);
    // A lost 200-job page always exceeds the cap of 5.
    expect(resolveListingCompleteness(9800, 10000).isComplete).toBe(false);
  });
});

describe("isDetailFailuresTolerable", () => {
  it("tolerates zero failures and a single failure on small boards", () => {
    expect(isDetailFailuresTolerable(0, 500)).toBe(true);
    expect(isDetailFailuresTolerable(1, 1)).toBe(true);
  });

  it("rejects failure counts beyond the capped tolerance", () => {
    expect(isDetailFailuresTolerable(2, 50)).toBe(false);
    expect(isDetailFailuresTolerable(3, 50)).toBe(false);
    expect(isDetailFailuresTolerable(11, 500)).toBe(false);
  });

  it("never tolerates failures when nothing hydrated", () => {
    expect(isDetailFailuresTolerable(1, 0)).toBe(false);
    expect(isDetailFailuresTolerable(0, 0)).toBe(true);
  });

  it("allows two failures once the board is large enough", () => {
    expect(isDetailFailuresTolerable(2, 200)).toBe(true);
    expect(isDetailFailuresTolerable(3, 200)).toBe(false);
  });
});
