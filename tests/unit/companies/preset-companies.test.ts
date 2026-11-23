import { describe, expect, it } from "vitest";

import {
  excludeExistingPresetCompanies,
  getAddablePresetCompanies,
  getDefaultAddCompanyTab,
  parsePresetCompanies,
  searchPresetCompanies,
} from "@/lib/companies/preset-companies";
import { normalizeCareersUrl } from "@/lib/companies/normalization";
import { isCompanyScrapeSupported } from "@/lib/companies/scrape-support";
import presetCatalog from "@/public/companies.json";

describe("preset companies utils", () => {
  it("keeps every published preset valid, unique, active, and scrapeable", () => {
    const presets = parsePresetCompanies(presetCatalog);

    expect(presets).toHaveLength(presetCatalog.length);
    expect(presets.length).toBeGreaterThan(0);
    for (const company of presets) {
      expect(isCompanyScrapeSupported(company.careersUrl, company.platform), company.name).toBe(true);
      expect(company.isActive, company.name).toBe(true);
      expect(company.logoUrl, company.name).toMatch(/^https:\/\//);
    }
  });

  it.each([
    ["Goldman Sachs", "oracle", "hdpc.fa.us2.oraclecloud.com/CX_3002"],
    ["BNY", "oracle", "eofe.fa.us2.oraclecloud.com/CX_3001"],
    ["Flipkart", "turbohire", "4d757ba0-3d57-448a-b82c-238ed87ac90f"],
    ["PhonePe", "smartrecruiters", "PHONEPELIMITED"],
  ])("preserves the explicit branded-board mapping for %s", (name, platform, boardToken) => {
    expect(parsePresetCompanies(presetCatalog).find((company) => company.name === name))
      .toMatchObject({ platform, boardToken });
  });

  it("normalizes careers URLs for dedupe matching", () => {
    expect(
      normalizeCareersUrl("HTTPS://Jobs.Lever.co/acme/?team=eng")
    ).toBe("jobs.lever.co/acme");

    expect(normalizeCareersUrl("https://job-boards.greenhouse.io/acme/")).toBe(
      "job-boards.greenhouse.io/acme"
    );

    expect(normalizeCareersUrl("https://www.example.com/path/?x=1")).toBe(
      "example.com/path"
    );

    expect(normalizeCareersUrl("  not-a-url/  ")).toBe("not-a-url");
  });

  it("parses valid entries and filters invalid/duplicate entries", () => {
    const parsed = parsePresetCompanies([
      {
        name: "Acme",
        careersUrl: "https://jobs.lever.co/acme",
        logoUrl: "",
        platform: "lever",
        boardToken: "",
      },
      {
        name: "",
        careersUrl: "https://jobs.lever.co/bad",
      },
      {
        name: "Acme Duplicate",
        careersUrl: "https://jobs.lever.co/acme/",
      },
      {
        name: "Beta",
        careersUrl: "https://job-boards.greenhouse.io/beta",
        platform: "greenhouse",
      },
      {
        name: "PhonePe",
        careersUrl: "https://www.phonepe.com/careers/job-openings/",
        platform: "smartrecruiters",
        boardToken: "PHONEPELIMITED",
      },
    ]);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      name: "Acme",
      careersUrl: "https://jobs.lever.co/acme",
      logoUrl: undefined,
      boardToken: undefined,
      platform: "lever",
    });
    expect(parsed[1]).toMatchObject({
      name: "Beta",
      platform: "greenhouse",
    });
    expect(parsed[2]).toMatchObject({
      name: "PhonePe",
      platform: "smartrecruiters",
      boardToken: "PHONEPELIMITED",
    });
  });

  it("searches by name, url, and platform", () => {
    const items = parsePresetCompanies([
      {
        name: "Acme",
        careersUrl: "https://jobs.lever.co/acme",
        platform: "lever",
      },
      {
        name: "Beta",
        careersUrl: "https://job-boards.greenhouse.io/beta",
        platform: "greenhouse",
      },
    ]);

    expect(searchPresetCompanies(items, "acme")).toHaveLength(1);
    expect(searchPresetCompanies(items, "greenhouse")).toHaveLength(1);
    expect(searchPresetCompanies(items, "job-boards.greenhouse.io")).toHaveLength(
      1
    );
    expect(searchPresetCompanies(items, "   ")).toHaveLength(2);
  });

  it("excludes entries already present in local companies", () => {
    const items = parsePresetCompanies([
      {
        name: "Acme",
        careersUrl: "https://jobs.lever.co/acme",
      },
      {
        name: "Beta",
        careersUrl: "https://job-boards.greenhouse.io/beta",
      },
    ]);

    const filtered = excludeExistingPresetCompanies(items, [
      "https://jobs.lever.co/acme/",
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("Beta");
  });

  it("excludes presets already added by careers URL or company name", () => {
    const items = parsePresetCompanies([
      {
        name: "Acme",
        careersUrl: "https://jobs.lever.co/acme",
      },
      {
        name: "Beta",
        careersUrl: "https://job-boards.greenhouse.io/beta",
      },
      {
        name: "Gamma",
        careersUrl: "https://jobs.ashbyhq.com/gamma",
      },
    ]);

    expect(getAddablePresetCompanies(items, [
      { name: "Acme Renamed", careersUrl: "https://jobs.lever.co/acme/" },
      { name: "Beta", careersUrl: "https://example.com/beta-careers" },
    ])).toEqual([expect.objectContaining({ name: "Gamma" })]);
  });

  it("defaults to Custom Company only when every preset is already added", () => {
    const items = parsePresetCompanies([
      {
        name: "Acme",
        careersUrl: "https://jobs.lever.co/acme",
      },
    ]);

    expect(getDefaultAddCompanyTab(undefined, [])).toBe("quick");
    expect(getDefaultAddCompanyTab(items, [])).toBe("quick");
    expect(getDefaultAddCompanyTab(items, [
      { name: "Acme", careersUrl: "https://jobs.lever.co/acme" },
    ])).toBe("manual");
  });
});
