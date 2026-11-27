/** Workday listing summaries contain counts rather than actual location names. */
export function isLocationCountLabel(value: string | null | undefined): boolean {
  return /^(?:\d+\s+locations?|multiple\s+locations?)$/i.test(value?.trim() ?? "");
}

export function normalizeJobLocations(
  location?: string | null,
  locations?: readonly string[] | null
): string[] {
  const seen = new Set<string>();
  const clean = (values: readonly string[]) => values.flatMap((value) => {
    const label = value.trim().replace(/\s+/g, " ");
    const key = label.toLowerCase();
    if (!label || isLocationCountLabel(label) || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
  const names = clean(locations ?? []);
  return names.length ? names : clean(location ? [location] : []);
}

/** Preserve an honest count when the source has not supplied any names yet. */
export function formatJobLocation(
  location?: string | null,
  locations?: readonly string[] | null
): string | null {
  return normalizeJobLocations(location, locations).join("; ") || location?.trim() || null;
}
