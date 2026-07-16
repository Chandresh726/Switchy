interface ExperienceEntry {
  startDate?: string | null;
  endDate?: string | null;
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Calculate a factual non-overlapping employment duration for provenance. */
export function calculateTotalExperienceYears(
  experience: ExperienceEntry[],
  referenceTime = Date.now()
): number | null {
  if (experience.length === 0) return null;

  const intervals: Array<[number, number]> = [];
  for (const item of experience) {
    const start = toTimestamp(item.startDate);
    if (start === null) continue;
    const parsedEnd = toTimestamp(item.endDate);
    if (item.endDate && parsedEnd === null) continue;
    const end = Math.min(parsedEnd ?? referenceTime, referenceTime);
    if (end > start) intervals.push([start, end]);
  }
  if (intervals.length === 0) return null;

  intervals.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || start > previous[1]) {
      merged.push([start, end]);
    } else {
      previous[1] = Math.max(previous[1], end);
    }
  }

  const totalMs = merged.reduce((sum, [start, end]) => sum + end - start, 0);
  const totalYears = totalMs / (365.25 * 24 * 60 * 60 * 1000);
  return totalYears > 0 ? Math.round(totalYears * 10) / 10 : null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n\n")
    .replace(/<(p|div|h[1-6]|li|tr)[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}
