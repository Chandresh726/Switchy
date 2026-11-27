import { createHash } from "node:crypto";

export interface WorkdayFacet {
  facetParameter?: string;
  descriptor?: string;
  id?: string;
  count?: number;
  values?: WorkdayFacet[];
}

export interface WorkdayCountryPolicy {
  mode: "auto" | "country-only" | "disabled";
  /** Optional advertised parameter for a board with an ambiguous facet label. */
  parameter?: string;
  /** Country labels and location tokens, independent of the board's opaque IDs. */
  aliases: Record<string, readonly string[]>;
  validationTtlMs: number;
}

export interface WorkdayBoardPolicy {
  hostname: string;
  board?: string;
  countryFilter?: Partial<WorkdayCountryPolicy>;
}

export const DEFAULT_WORKDAY_COUNTRY_POLICY: WorkdayCountryPolicy = {
  mode: "auto",
  aliases: {
    india: ["India", "IND"],
    "united states": ["United States", "United States of America", "USA"],
    "united kingdom": ["United Kingdom", "GBR", "UK"],
    germany: ["Germany", "Deutschland", "DEU"],
    canada: ["Canada", "CAN"],
  },
  // Reuse validation across the default six-hour schedule. Facet ID/label
  // changes invalidate it immediately, independently of this daily expiry.
  validationTtlMs: 24 * 60 * 60_000,
};

export interface WorkdayCountryPlan {
  country: string;
  kind: "country" | "locations";
  parameter: string;
  ids: string[];
  appliedFacets: Record<string, string[]>;
  fingerprint: string;
  expectedMaximum: number | null;
}

export function readWorkdayFacets(value: unknown, depth = 0): WorkdayFacet[] {
  if (!Array.isArray(value) || depth > 16) return [];
  return value.flatMap((item): WorkdayFacet[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [{
      facetParameter: typeof record.facetParameter === "string" ? record.facetParameter : undefined,
      descriptor: typeof record.descriptor === "string" ? record.descriptor : undefined,
      id: typeof record.id === "string" ? record.id : undefined,
      count: typeof record.count === "number" && Number.isFinite(record.count) && record.count >= 0 ? record.count : undefined,
      values: readWorkdayFacets(record.values, depth + 1),
    }];
  });
}

export function canonicalWorkdayScope(input: {
  baseUrl: string; tenant: string; board: string; searchText: string; appliedFacets: Record<string, string[]>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    baseUrl: input.baseUrl, tenant: input.tenant, board: input.board, searchText: input.searchText,
    appliedFacets: Object.fromEntries(Object.entries(input.appliedFacets).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, [...new Set(values)].sort()])),
  })).digest("hex");
}

export function resolveWorkdayCountryPolicy(
  source: { baseUrl: string; board: string },
  policy: WorkdayCountryPolicy,
  overrides: readonly WorkdayBoardPolicy[]
): WorkdayCountryPolicy {
  const hostname = new URL(source.baseUrl).hostname.toLowerCase();
  const matches = overrides.filter((entry) => entry.hostname.toLowerCase() === hostname);
  const hostPolicy = matches.find((entry) => !entry.board)?.countryFilter;
  const boardPolicy = matches.find((entry) => entry.board === source.board)?.countryFilter;
  return {
    ...policy, ...hostPolicy, ...boardPolicy,
    aliases: { ...policy.aliases, ...hostPolicy?.aliases, ...boardPolicy?.aliases },
  };
}

export function discoverWorkdayCountryPlan(
  facets: WorkdayFacet[], country: string | undefined,
  existing: Record<string, string[]>, policy: WorkdayCountryPolicy
): WorkdayCountryPlan | null {
  if (!country?.trim() || policy.mode === "disabled") return null;
  const normalized = country.trim().toLowerCase();
  const aliases = [...new Set([country.trim(), ...(policy.aliases[normalized] ?? [])])];
  const names = new Set(aliases.map((value) => value.toLowerCase()));
  const flattened: WorkdayFacet[] = [];
  const visit = (facet: WorkdayFacet) => {
    if (facet.facetParameter && facet.values?.some((value) => value.id)) flattened.push(facet);
    for (const value of facet.values ?? []) visit(value);
  };
  for (const facet of facets) visit(facet);
  const exactCountry = (facet: WorkdayFacet) =>
    (policy.parameter ? facet.facetParameter === policy.parameter : /country/i.test(`${facet.facetParameter} ${facet.descriptor}`)) &&
    facet.values?.some((value) => value.descriptor && names.has(value.descriptor.toLowerCase()));
  let facet = flattened.find(exactCountry);
  const kind = facet ? "country" : "locations";
  if (!facet && policy.mode !== "country-only") {
    facet = flattened.find((entry) =>
      (policy.parameter ? entry.facetParameter === policy.parameter : /location/i.test(entry.facetParameter ?? "")) &&
      entry.values?.some((value) => matchesToken(value.descriptor, aliases)));
  }
  if (!facet?.facetParameter) return null;
  const selected = (facet.values ?? []).filter((value) => value.id &&
    (kind === "country" ? names.has(value.descriptor?.toLowerCase() ?? "") : matchesToken(value.descriptor, aliases)));
  const existingValues = existing[facet.facetParameter];
  // Same-facet values are an intersection with the configured source, never a
  // replacement that silently broadens a country/category-constrained URL.
  const ids = selected.flatMap((value) => value.id && (!existingValues?.length || existingValues.includes(value.id)) ? [value.id] : []);
  if (!ids.length) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    country: normalized, parameter: facet.facetParameter, kind,
    values: (facet.values ?? []).map((value) => [value.id, value.descriptor]).sort(), ids: [...ids].sort(),
  })).digest("hex");
  const counts = selected.filter((value) => ids.includes(value.id!)).map((value) => value.count);
  return {
    country: country.trim(), kind, parameter: facet.facetParameter, ids,
    appliedFacets: { ...existing, [facet.facetParameter]: ids }, fingerprint,
    expectedMaximum: counts.every((count) => count !== undefined) ? counts.reduce<number>((sum, count) => sum + count!, 0) : null,
  };
}

function matchesToken(value: string | undefined, aliases: string[]): boolean {
  return Boolean(value && aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "i").test(value);
  }));
}
