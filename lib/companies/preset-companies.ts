import { z } from "zod";

const PLATFORM_VALUES = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "eightfold",
  "uber",
  "google",
  "atlassian",
  "custom",
] as const;

const PlatformSchema = z
  .union([z.enum(PLATFORM_VALUES), z.literal(""), z.null()])
  .optional();

const OptionalUrlSchema = z
  .union([z.string().trim().url(), z.literal(""), z.null()])
  .optional();

const OptionalTextSchema = z.union([z.string(), z.literal(""), z.null()]).optional();

const PresetCompanySchema = z
  .object({
    name: z.string().trim().min(1),
    careersUrl: z.string().trim().url(),
    logoUrl: OptionalUrlSchema,
    platform: PlatformSchema,
    boardToken: OptionalTextSchema,
    isActive: z.boolean().optional(),
  })
  .transform((value) => ({
    name: value.name,
    careersUrl: value.careersUrl.trim(),
    logoUrl: normalizeOptionalText(value.logoUrl),
    platform: normalizePlatform(value.platform),
    boardToken: normalizeOptionalText(value.boardToken),
    isActive: value.isActive,
  }));

export type PresetCompany = z.infer<typeof PresetCompanySchema>;

function normalizeOptionalText(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePlatform(
  value?: (typeof PLATFORM_VALUES)[number] | "" | null
): (typeof PLATFORM_VALUES)[number] | undefined {
  if (!value) return undefined;
  return value;
}

export function normalizeCareersUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let pathname = parsed.pathname.replace(/\/+$/g, "");
    if (pathname.length === 0) {
      pathname = "/";
    }

    return `${hostname}${pathname}`;
  } catch {
    const normalized = trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[?#]/)[0];

    if (!normalized) return "";
    const withoutTrailingSlash = normalized.replace(/\/+$/g, "");
    return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : "/";
  }
}

export function parsePresetCompanies(raw: unknown): PresetCompany[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const parsed: PresetCompany[] = [];

  for (const item of raw) {
    const result = PresetCompanySchema.safeParse(item);
    if (!result.success) {
      continue;
    }

    const normalizedUrl = normalizeCareersUrl(result.data.careersUrl);
    if (seen.has(normalizedUrl)) {
      continue;
    }

    seen.add(normalizedUrl);
    parsed.push(result.data);
  }

  return parsed;
}

export function searchPresetCompanies(
  items: PresetCompany[],
  query: string
): PresetCompany[] {
  const searchQuery = query.trim().toLowerCase();
  if (!searchQuery) {
    return items;
  }

  return items.filter((company) => {
    const haystacks = [
      company.name.toLowerCase(),
      company.careersUrl.toLowerCase(),
      company.platform?.toLowerCase() ?? "",
    ];

    return haystacks.some((value) => value.includes(searchQuery));
  });
}

export function excludeExistingPresetCompanies(
  items: PresetCompany[],
  existingCareersUrls: Iterable<string>
): PresetCompany[] {
  const existingUrls = new Set<string>();
  for (const url of existingCareersUrls) {
    existingUrls.add(normalizeCareersUrl(url));
  }

  return items.filter(
    (company) => !existingUrls.has(normalizeCareersUrl(company.careersUrl))
  );
}
