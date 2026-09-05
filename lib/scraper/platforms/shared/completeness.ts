/**
 * Shared tolerance for listing completeness.
 *
 * Board APIs routinely advertise totals that drift by a handful of jobs
 * (index lag, in-flight postings). Treating "7326 of 7328" as a failure
 * poisoned every scheduled session to `partial`, so near-complete fetches
 * count as complete and carry a warning instead.
 *
 * The allowance is capped at 5 so small boards stay strict (9 of 10 is
 * fine; 5 of 10 is not) and genuine page failures on large boards still
 * fail (a lost 200-job page always exceeds the cap).
 */
export const LISTING_COMPLETENESS_ABSOLUTE_TOLERANCE = 5;
export const LISTING_COMPLETENESS_RATIO_TOLERANCE = 0.01;

export function resolveListingCompleteness(
  fetched: number,
  advertised: number
): { isComplete: boolean; missing: number } {
  const missing = Math.max(0, advertised - fetched);
  if (fetched === 0 && advertised > 0) return { isComplete: false, missing };
  if (missing === 0) return { isComplete: true, missing };
  const tolerance = Math.max(
    1,
    Math.min(
      LISTING_COMPLETENESS_ABSOLUTE_TOLERANCE,
      Math.ceil(advertised * LISTING_COMPLETENESS_RATIO_TOLERANCE)
    )
  );
  return { isComplete: missing <= tolerance, missing };
}

/**
 * A handful of failed detail hydrations should not fail a board with
 * hundreds of listings either. Listings are retained as fallbacks, so small
 * failure counts degrade to warnings.
 */
export const DETAIL_FAILURE_ABSOLUTE_TOLERANCE = 2;
export const DETAIL_FAILURE_RATIO_TOLERANCE = 0.01;

export function isDetailFailuresTolerable(
  failures: number,
  hydratedTotal: number
): boolean {
  if (failures <= 0) return true;
  const tolerance = Math.max(
    1,
    Math.min(
      DETAIL_FAILURE_ABSOLUTE_TOLERANCE,
      Math.ceil(hydratedTotal * DETAIL_FAILURE_RATIO_TOLERANCE)
    )
  );
  return failures <= tolerance;
}
