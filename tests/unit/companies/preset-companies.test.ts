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
  it("maps the reusable ATS company set to canonical boards", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/companies.json"), "utf8")
    ) as unknown;
    const presets = parsePresetCompanies(raw);
    const expected = {
      Nutanix: ["https://jobs.jobvite.com/nutanix/jobs", "jobvite", "nutanix"],
      LegalZoom: ["https://jobs.jobvite.com/legalzoom/jobs", "jobvite", "legalzoom"],
      Intuit: ["https://jobs.intuit.com/search-jobs", "talentbrew", "27595"],
      "Goldman Sachs": [
        "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs",
        "oracle",
        "hdpc.fa.us2.oraclecloud.com/CX_3002",
      ],
      eBay: ["https://jobs.ebayinc.com/us/en/search-results", "phenom", "EBAEBAUS"],
    } as const;

    for (const [name, [careersUrl, platform, boardToken]] of Object.entries(expected)) {
      expect(presets.find((company) => company.name === name)).toMatchObject({
        careersUrl,
        platform,
        boardToken,
        isActive: true,
      });
      expect(detectPlatformFromUrl(careersUrl)).toBe(platform);
    }
    expect(presets.find((company) => company.name === "Goldman Sach")).toBeUndefined();
  });

  it("includes the Oracle Recruiting and Phenom quick-add additions", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/companies.json"), "utf8")
    ) as unknown;
    const presets = parsePresetCompanies(raw);
    const expected = {
      "Texas Instruments": [
        "https://careers.ti.com/en/sites/CX/jobs",
        "oracle",
        "careers.ti.com/CX",
      ],
      Oracle: [
        "https://careers.oracle.com/en/sites/jobsearch/jobs",
        "oracle",
        "careers.oracle.com/CX_45001",
      ],
      "JPMorgan Chase": [
        "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions",
        "oracle",
        "jpmc.fa.oraclecloud.com/CX_1001",
      ],
      BNY: [
        "https://eofe.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/BNY-Careers/jobs",
        "oracle",
        "eofe.fa.us2.oraclecloud.com/CX_3001",
      ],
      Cisco: [
        "https://careers.cisco.com/global/en/search-results",
        "phenom",
        "CISCISGLOBAL",
      ],
      Splunk: [
        "https://careers.cisco.com/global/en/splunk/search-page",
        "phenom",
        "CISCISGLOBAL",
      ],
    } as const;

    for (const [name, [careersUrl, platform, boardToken]] of Object.entries(expected)) {
      const preset = presets.find((company) => company.name === name);
      expect(preset).toMatchObject({
        careersUrl,
        platform,
        boardToken,
        isActive: true,
      });
      if (name === "BNY") {
        expect(preset?.logoUrl).toBe(
          "https://www.bny.com/content/dam/bnymellon/images/about-us/bny-logo---2024-brand-update.png"
        );
      } else {
        expect(preset?.logoUrl).toMatch(
          /^https:\/\/www\.google\.com\/s2\/favicons\?domain=.+&sz=128$/u
        );
      }
      expect(detectPlatformFromUrl(careersUrl)).toBe(platform);
    }
  });

  it("configures Flipkart for its canonical TurboHire organization", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/companies.json"), "utf8")
    ) as unknown;
    const flipkart = parsePresetCompanies(raw).find(
      (company) => company.name === "Flipkart"
    );

    expect(flipkart).toMatchObject({
      careersUrl:
        "https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f",
      platform: "turbohire",
      boardToken: "4d757ba0-3d57-448a-b82c-238ed87ac90f",
    });
  });

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

  it("includes the live-validated ATS discovery batch", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/companies.json"), "utf8")
    ) as unknown;
    const presets = parsePresetCompanies(raw);
    const expectedByPlatform = {
      smartrecruiters: ["Freshworks"],
      workday: [
        "Intel",
        "Palo Alto Networks",
        "BrowserStack",
        "Samsung R&D",
        "Barclays",
        "Citi",
        "Target India",
        "Sprinklr",
        "Expedia Group",
      ],
      greenhouse: ["Arcesium", "Sourcegraph"],
      ashby: ["Kraken"],
      lever: ["Palantir"],
    } as const;

    const expectedNames = Object.values(expectedByPlatform).flat();
    expect(expectedNames).toHaveLength(14);

    const expectedBoards = {
      Intel: ["https://intel.wd1.myworkdayjobs.com/External", "intel/External"],
      "Palo Alto Networks": [
        "https://paloaltonetworks.wd5.myworkdayjobs.com/panwexternalcareers",
        "paloaltonetworks/panwexternalcareers",
      ],
      BrowserStack: [
        "https://browserstack.wd3.myworkdayjobs.com/External",
        "browserstack/External",
      ],
      Freshworks: ["https://careers.smartrecruiters.com/Freshworks", "Freshworks"],
      "Samsung R&D": [
        "https://sec.wd3.myworkdayjobs.com/Samsung_Careers",
        "sec/Samsung_Careers",
      ],
      Barclays: [
        "https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays",
        "barclays/External_Career_Site_Barclays",
      ],
      Citi: ["https://citi.wd5.myworkdayjobs.com/2", "citi/2"],
      "Target India": [
        "https://target.wd5.myworkdayjobs.com/targetcareers",
        "target/targetcareers",
      ],
      Sprinklr: [
        "https://sprinklr.wd1.myworkdayjobs.com/careers",
        "sprinklr/careers",
      ],
      Arcesium: [
        "https://job-boards.greenhouse.io/arcesiumllc",
        "arcesiumllc",
      ],
      "Expedia Group": [
        "https://expedia.wd108.myworkdayjobs.com/search",
        "expedia/search",
      ],
      Kraken: ["https://jobs.ashbyhq.com/kraken.com", "kraken.com"],
      Sourcegraph: [
        "https://job-boards.greenhouse.io/sourcegraph91",
        "sourcegraph91",
      ],
      Palantir: ["https://jobs.lever.co/palantir", "palantir"],
    } as const;

    for (const [name, [careersUrl, boardToken]] of Object.entries(expectedBoards)) {
      expect(presets.find((preset) => preset.name === name)).toMatchObject({
        careersUrl,
        boardToken,
      });
    }

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
