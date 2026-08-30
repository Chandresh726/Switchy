import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  excludeExistingPresetCompanies,
  getAddablePresetCompanies,
  getDefaultAddCompanyTab,
  parsePresetCompanies,
  searchPresetCompanies,
} from "@/lib/companies/preset-companies";
import { normalizeCareersUrl } from "@/lib/companies/normalization";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

describe("preset companies utils", () => {
  it("configures PhonePe for its branded SmartRecruiters board", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/companies.json"), "utf8")
    ) as unknown;
    const phonePe = parsePresetCompanies(raw).find((company) => company.name === "PhonePe");

    expect(phonePe).toMatchObject({
      careersUrl: "https://www.phonepe.com/careers/job-openings/",
      platform: "smartrecruiters",
      boardToken: "PHONEPELIMITED",
    });
  });

  it("includes the researched quick-add batch with logos and supported scrapers", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/companies.json"), "utf8")
    ) as unknown;
    const presets = parsePresetCompanies(raw);
    const expectedByPlatform = {
      smartrecruiters: ["Adobe", "Canva"],
      workday: ["Workday", "Broadcom", "Mastercard", "Dell", "ASML"],
      lever: [
        "Nium",
        "Meesho",
        "CRED",
        "Fi Money",
        "Mindtickle",
        "JumpCloud",
        "H1",
        "Zimperium",
        "Apollo Research",
        "Institute of Foundation Models",
        "Spotify",
      ],
      ashby: [
        "Navi",
        "Sarvam AI",
        "Tekion",
        "Snowflake",
        "Deel",
        "PostHog",
        "GitBook",
        "Docker",
        "Sentry",
      ],
      greenhouse: [
        "InMobi",
        "Druva",
        "Truecaller",
        "Elastic",
        "MongoDB",
        "Remote",
        "Canonical",
        "Grafana Labs",
        "Dscout",
        "Customer.io",
        "Tailscale",
        "Wikimedia Foundation",
        "PQShield",
        "Adyen",
        "IMC Trading",
        "Jane Street",
        "Wise",
        "N26",
        "Wolt",
      ],
    } as const;

    const expectedNames = Object.values(expectedByPlatform).flat();
    expect(expectedNames).toHaveLength(46);

    for (const [platform, names] of Object.entries(expectedByPlatform)) {
      for (const name of names) {
        const company = presets.find((preset) => preset.name === name);

        expect(company, `${name} should be present`).toBeDefined();
        expect(company).toMatchObject({
          platform,
          isActive: true,
        });
        expect(company?.logoUrl).toMatch(
          /^https:\/\/www\.google\.com\/s2\/favicons\?domain=.+&sz=128$/u
        );
        expect(company?.boardToken).toBeTruthy();
        expect(detectPlatformFromUrl(company?.careersUrl ?? "")).toBe(platform);
      }
    }
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
