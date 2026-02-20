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

    const keywordRequirements = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) =>
        /(requirements?|qualifications?|must\s+have|required|experience\s+with|proficient\s+in)/i.test(line)
      )
      .map((line) => line.replace(/^[•\-*]\s*/, ""))
      .slice(0, 20);

    if (keywordRequirements.length > 0) {
      const seen = new Set<string>();
      return keywordRequirements.filter((req) => {
        const normalized = req.toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
    }
  } catch {
    // Ignore parsing errors
  }

  return [];
}

interface ExperienceEntry {
  startDate?: string | null;
  endDate?: string | null;
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function calculateTotalExperienceYears(experience: ExperienceEntry[]): number | null {
  if (experience.length === 0) return null;

  const now = Date.now();
  const intervals: Array<[number, number]> = [];

  for (const item of experience) {
    const start = toTimestamp(item.startDate);
    if (start === null) continue;

    const end = toTimestamp(item.endDate) ?? now;
    if (end <= start) continue;

    intervals.push([start, end]);
  }

  if (intervals.length === 0) return null;

  intervals.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) {
      merged.push([start, end]);
      continue;
    }
    last[1] = Math.max(last[1], end);
  }

  const totalMs = merged.reduce((sum, [start, end]) => sum + (end - start), 0);
  const totalYears = totalMs / (365.25 * 24 * 60 * 60 * 1000);
  if (totalYears <= 0) return null;

  return Math.round(totalYears * 10) / 10;
}

export function deriveCandidateExperienceYears(
  roleYears: number | null,
  skillYears: Array<number | null | undefined>
): number | null {
  const skillMax = skillYears.reduce<number | null>((max, years) => {
    if (typeof years !== "number" || Number.isNaN(years) || years < 0) return max;
    return max === null ? years : Math.max(max, years);
  }, null);

  if (typeof roleYears === "number" && !Number.isNaN(roleYears) && roleYears >= 0) {
    if (skillMax === null) return roleYears;
    return Math.max(roleYears, skillMax);
  }

  return skillMax;
}

function collectNumbers(regex: RegExp, text: string, mapper: (match: RegExpExecArray) => number | null): number[] {
  const values: number[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text)) !== null) {
    const value = mapper(match);
    if (value !== null && Number.isFinite(value) && value > 0 && value <= 50) {
      values.push(value);
    }
  }

  return values;
}

export function estimateRequiredExperienceYears(
  description: string | null,
  requirements: string[]
): number | null {
  const fullText = [description ?? "", ...requirements].join("\n").toLowerCase();

  const rangeYears = collectNumbers(
    /(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:\+)?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)\b/gi,
    fullText,
    (match) => {
      const min = parseInt(match[1] ?? "", 10);
      const max = parseInt(match[2] ?? "", 10);
      if (Number.isNaN(min) || Number.isNaN(max)) return null;
      return Math.max(min, max);
    }
  );

  const explicitYears = collectNumbers(
    /(\d+)\s*(?:\+|plus)?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)\b/gi,
    fullText,
    (match) => {
      const years = parseInt(match[1] ?? "", 10);
      return Number.isNaN(years) ? null : years;
    }
  );

  const minimumYears = collectNumbers(
    /(?:minimum|min|at\s+least)\s+(\d+)\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/gi,
    fullText,
    (match) => {
      const years = parseInt(match[1] ?? "", 10);
      return Number.isNaN(years) ? null : years;
    }
  );

  const allYears = [...rangeYears, ...explicitYears, ...minimumYears];
  if (allYears.length === 0) return null;

  return Math.max(...allYears);
}

export function applyExperienceScoreGuardrails(
  score: number,
  requiredYears: number | null,
  candidateYears: number | null
): { adjustedScore: number; reason?: string } {
  if (requiredYears === null || candidateYears === null) {
    return { adjustedScore: score };
  }

  const gap = requiredYears - candidateYears;
  if (gap <= 0) {
    return { adjustedScore: score };
  }

  let adjusted = score;

  if (gap >= 3) {
    adjusted = Math.min(adjusted, score - 25, 50);
  } else {
    adjusted = Math.min(adjusted, score - 15, 75);
  }

  if (requiredYears >= 5 && candidateYears <= 2) {
    adjusted = Math.min(adjusted, 60);
  }

  if (requiredYears >= 5 && candidateYears < 1) {
    adjusted = Math.min(adjusted, 35);
  }

  const normalizedScore = Math.max(0, Math.round(adjusted));
  if (normalizedScore >= score) {
    return { adjustedScore: score };
  }

  const reason = `Adjusted for experience gap: role asks ~${requiredYears} years, profile indicates ~${candidateYears.toFixed(1)} years.`;
  return {
    adjustedScore: normalizedScore,
    reason,
  };
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
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
