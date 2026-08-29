import { z } from "zod";

import { normalizeCareersUrl } from "./normalization";

const PLATFORM_VALUES = [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "eightfold",
  "servicenow",
  "zwayam",
  "mynexthire",
  "uber",
  "google",
  "atlassian",
  "rippling",
  "visa",
  "nutanix",
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

export interface ExistingPresetCompany {
  name: string;
  careersUrl: string;
}

export type AddCompanyTab = "quick" | "manual";

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

export function getAddablePresetCompanies(
  items: PresetCompany[],
  existingCompanies: ExistingPresetCompany[],
  additionallyExcludedCareersUrls: Iterable<string> = []
): PresetCompany[] {
  const excludedCareersUrls = [
    ...existingCompanies.map((company) => company.careersUrl),
    ...additionallyExcludedCareersUrls,
  ];
  const existingNames = new Set(
    existingCompanies
      .map((company) => company.name.trim().toLowerCase())
      .filter((name) => name.length > 0)
  );

  return excludeExistingPresetCompanies(items, excludedCareersUrls).filter(
    (company) => !existingNames.has(company.name.trim().toLowerCase())
  );
}

export function getDefaultAddCompanyTab(
  presetCompanies: PresetCompany[] | undefined,
  existingCompanies: ExistingPresetCompany[]
): AddCompanyTab {
  if (!presetCompanies) return "quick";
  return getAddablePresetCompanies(presetCompanies, existingCompanies).length > 0
    ? "quick"
    : "manual";
}
