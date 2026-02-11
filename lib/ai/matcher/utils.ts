/**
 * Extract requirements from a job description
 * Looks for bullet-like lines (starting with -, *, •, or numbered items)
 */
export function extractRequirements(description: string | null): string[] {
  if (!description) return [];

  try {
    const lines = description.split(/\r?\n/);
    const reqs = lines
      .map((l) => l.trim())
      .map((l) => {
        const m = l.match(/^(?:[-*•]|\d+[.)])\s+(.+?)\s*$/);
        return m?.[1]?.trim() ?? "";
      })
      .filter(Boolean);

    if (reqs.length > 0) {
      const seen = new Set<string>();
      return reqs.filter((r) => {
        const key = r.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  } catch {
    // Ignore parsing errors
  }

  return [];
}

/**
 * Lightweight HTML to readable text conversion
 * Strips tags and converts common HTML entities
 */
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

/**
 * Split array into chunks of specified size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
