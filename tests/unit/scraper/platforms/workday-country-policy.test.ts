import { describe, expect, it } from "vitest";

import {
  canonicalWorkdayScope, DEFAULT_WORKDAY_COUNTRY_POLICY, discoverWorkdayCountryPlan,
  readWorkdayFacets, resolveWorkdayCountryPolicy,
} from "@/lib/scraper/platforms/workday/country-filter";

const country = (parameter = "Location_Country") => ({ facetParameter: parameter, descriptor: "Country", values: [
  { id: "in", descriptor: "India", count: 69 }, { id: "us", descriptor: "United States", count: 1000 },
] });

describe("Workday country policies", () => {
  it.each(["Location_Country", "locationCountry", "a"])("discovers advertised country parameter %s inside nested groups", (parameter) => {
    const facets = readWorkdayFacets([{ facetParameter: "locationMainGroup", values: [country(parameter)] }]);
    expect(discoverWorkdayCountryPlan(facets, "India", { category: ["engineering"] }, DEFAULT_WORKDAY_COUNTRY_POLICY)).toMatchObject({
      kind: "country", parameter, ids: ["in"], expectedMaximum: 69,
      appliedFacets: { category: ["engineering"], [parameter]: ["in"] },
    });
  });

  it("intersects existing same-facet constraints and never broadens a configured source", () => {
    expect(discoverWorkdayCountryPlan([country()], "India", { Location_Country: ["us"] }, DEFAULT_WORKDAY_COUNTRY_POLICY)).toBeNull();
    expect(discoverWorkdayCountryPlan([country()], "India", { Location_Country: ["us", "in"] }, DEFAULT_WORKDAY_COUNTRY_POLICY)?.ids).toEqual(["in"]);
  });

  it("selects location tokens without matching Indiana and invalidates proofs when facet identities change", () => {
    const facets = [{ facetParameter: "locations", values: [
      { id: "blr", descriptor: "IND-Bangalore", count: 2 },
      { id: "remote", descriptor: "Virtual India", count: 1 },
      { id: "us", descriptor: "Indianapolis, United States", count: 4 },
    ] }];
    const initial = discoverWorkdayCountryPlan(facets, "India", {}, DEFAULT_WORKDAY_COUNTRY_POLICY)!;
    expect(initial).toMatchObject({ kind: "locations", ids: ["blr", "remote"], expectedMaximum: 3 });
    facets[0].values[0].count = 3;
    expect(discoverWorkdayCountryPlan(facets, "India", {}, DEFAULT_WORKDAY_COUNTRY_POLICY)?.fingerprint).toBe(initial.fingerprint);
    facets[0].values.push({ id: "new", descriptor: "Bengaluru", count: 1 });
    expect(discoverWorkdayCountryPlan(facets, "India", {}, DEFAULT_WORKDAY_COUNTRY_POLICY)?.fingerprint).not.toBe(initial.fingerprint);
    expect(discoverWorkdayCountryPlan(facets, "India", {}, { ...DEFAULT_WORKDAY_COUNTRY_POLICY, mode: "country-only" })).toBeNull();
  });

  it("resolves typed board overrides by host and board, with the specific board taking precedence", () => {
    const policy = resolveWorkdayCountryPolicy({ baseUrl: "https://example.wd5.myworkdayjobs.com", board: "External" }, DEFAULT_WORKDAY_COUNTRY_POLICY, [
      { hostname: "example.wd5.myworkdayjobs.com", countryFilter: { mode: "disabled", validationTtlMs: 1000 } },
      { hostname: "example.wd5.myworkdayjobs.com", board: "External", countryFilter: { mode: "country-only", parameter: "custom", aliases: { france: ["France", "FRA"] } } },
    ]);
    expect(policy).toMatchObject({ mode: "country-only", parameter: "custom", validationTtlMs: 1000 });
    expect(policy.aliases.india).toContain("India");
    expect(policy.aliases.france).toContain("FRA");
    expect(discoverWorkdayCountryPlan([country()], "India", {}, { ...policy, mode: "disabled" })).toBeNull();
  });

  it("canonicalizes the entire query scope independently of key and value ordering", () => {
    const source = { baseUrl: "https://example.com", tenant: "example", board: "External", searchText: "Engineer" };
    const first = canonicalWorkdayScope({ ...source, appliedFacets: { country: ["in", "us"], jobType: ["full"] } });
    expect(canonicalWorkdayScope({ ...source, appliedFacets: { jobType: ["full"], country: ["us", "in"] } })).toBe(first);
    expect(canonicalWorkdayScope({ ...source, searchText: "Developer", appliedFacets: { country: ["in", "us"], jobType: ["full"] } })).not.toBe(first);
  });
});
