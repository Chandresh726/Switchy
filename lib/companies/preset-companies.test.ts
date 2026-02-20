import { describe, expect, it } from "vitest";

import {
  excludeExistingPresetCompanies,
  normalizeCareersUrl,
  parsePresetCompanies,
  searchPresetCompanies,
} from "@/lib/companies/preset-companies";

describe("preset companies utils", () => {
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
    ]);

    expect(parsed).toHaveLength(2);
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
});
