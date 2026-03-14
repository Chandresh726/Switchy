import { describe, expect, it } from "vitest";

import { isCompanyScrapeSupported, resolveCompanyScrapePlatform } from "@/lib/companies/scrape-support";

describe("company scrape support", () => {
  it("treats custom companies without a supported scraper as unsupported", () => {
    expect(isCompanyScrapeSupported("https://careers.example.com", "custom")).toBe(false);
    expect(resolveCompanyScrapePlatform("https://careers.example.com", "custom")).toBeNull();
  });

  it("treats supported stored platforms as scrapeable", () => {
    expect(isCompanyScrapeSupported("https://boards.greenhouse.io/acme", "greenhouse")).toBe(true);
    expect(resolveCompanyScrapePlatform("https://boards.greenhouse.io/acme", "greenhouse")).toBe("greenhouse");
  });

  it("treats supported custom scraper platforms as scrapeable", () => {
    expect(isCompanyScrapeSupported("https://www.google.com/about/careers", "google")).toBe(true);
    expect(resolveCompanyScrapePlatform("https://www.google.com/about/careers", "google")).toBe("google");
  });

  it("treats new ATS and company-specific platforms as scrapeable", () => {
    expect(isCompanyScrapeSupported("https://careers.servicenow.com/jobs", "servicenow")).toBe(true);
    expect(isCompanyScrapeSupported("https://www.flipkartcareers.com/flipkart/jobslist", "zwayam")).toBe(true);
    expect(isCompanyScrapeSupported("https://careers.swiggy.com/#/careers", "mynexthire")).toBe(true);
    expect(isCompanyScrapeSupported("https://www.visa.co.uk/en_gb/jobs/", "visa")).toBe(true);
  });

  it("detects supported platforms from URL when platform is not stored", () => {
    expect(resolveCompanyScrapePlatform("https://www.flipkartcareers.com/flipkart/jobslist", null)).toBe("zwayam");
    expect(resolveCompanyScrapePlatform("https://careers.swiggy.com/#/careers", null)).toBe("mynexthire");
  });
});
