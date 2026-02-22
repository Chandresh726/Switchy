import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import { parseEmploymentType } from "@/lib/scraper/types";

export function normalizeDescription(
  description: string | null | undefined
): { description: string | undefined; descriptionFormat: "markdown" | "plain" } {
  if (!description || description.trim().length === 0) {
    return { description: undefined, descriptionFormat: "plain" };
  }

  if (containsHtml(description)) {
    const processed = processDescription(description, "html");
    return {
      description: processed.text ?? undefined,
      descriptionFormat: processed.format,
    };
  }

  const processed = processDescription(description, "plain");
  return {
    description: processed.text ?? undefined,
    descriptionFormat: processed.format,
  };
}

export function normalizePostedDate(value: string | number | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "number") {
    if (value <= 0) return undefined;
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (!value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeEmploymentType(value: string | undefined): ReturnType<typeof parseEmploymentType> {
  if (!value) return undefined;

  const normalized = value
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z-]/g, "");

  return parseEmploymentType(normalized);
}
