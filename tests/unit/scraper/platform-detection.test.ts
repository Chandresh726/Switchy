import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

describe("platform detection", () => {
  it("detects known platforms from careers URLs", () => {
    expect(detectPlatformFromUrl("https://boards.greenhouse.io/acme")).toBe("greenhouse");
    expect(detectPlatformFromUrl("https://careers.smartrecruiters.com/Acme")).toBe("smartrecruiters");
    expect(detectPlatformFromUrl("https://jobs.smartrecruiters.com/Acme/123-role")).toBe("smartrecruiters");
    expect(detectPlatformFromUrl("https://jobs.lever.co/acme")).toBe("lever");
    expect(detectPlatformFromUrl("https://jobs.ashbyhq.com/acme")).toBe("ashby");
    expect(detectPlatformFromUrl("https://acme.wd5.myworkdayjobs.com/en-US/careers")).toBe("workday");
    expect(detectPlatformFromUrl("https://acme.eightfold.ai/careers")).toBe("eightfold");
    expect(detectPlatformFromUrl("https://careers.servicenow.com/jobs")).toBe("servicenow");
    expect(detectPlatformFromUrl("https://www.flipkartcareers.com/flipkart/jobslist")).toBe("turbohire");
    expect(
      detectPlatformFromUrl(
        "https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f"
      )
    ).toBe("turbohire");
    expect(
      detectPlatformFromUrl(
        "https://flipkart.turbohire.co/careerpage/not-an-organization-id"
      )
    ).toBe("custom");
    expect(detectPlatformFromUrl("https://swiggy.mynexthire.com/employer/careers")).toBe("mynexthire");
    expect(detectPlatformFromUrl("https://careers.swiggy.com/#/careers")).toBe("mynexthire");
    expect(detectPlatformFromUrl("https://www.visa.co.uk/en_gb/jobs/?functions=Technology")).toBe("visa");
    expect(
      detectPlatformFromUrl(
        "https://www.google.com/about/careers/applications/jobs/results?q=software"
      )
    ).toBe("google");
    expect(detectPlatformFromUrl("https://www.google.com/about/careers/")).toBe("google");
    expect(detectPlatformFromUrl("https://careers.google.com/jobs/results/")).toBe("google");
    expect(detectPlatformFromUrl("https://jobs.jobvite.com/nutanix/jobs")).toBe("jobvite");
    expect(detectPlatformFromUrl("https://careers.nutanix.com/en/jobs/")).toBe("jobvite");
    expect(detectPlatformFromUrl("https://jobs.intuit.com/search-jobs")).toBe("talentbrew");
    expect(
      detectPlatformFromUrl(
        "https://hdpc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/LateralHiring/jobs"
      )
    ).toBe("oracle");
    expect(detectPlatformFromUrl("https://higher.gs.com/results")).toBe("oracle");
    expect(detectPlatformFromUrl("https://careers.ti.com/en/sites/CX/jobs")).toBe("oracle");
    expect(
      detectPlatformFromUrl("https://careers.oracle.com/en/sites/jobsearch/jobs")
    ).toBe("oracle");
    expect(detectPlatformFromUrl("https://jobs.ebayinc.com/us/en/search-results")).toBe("phenom");
    expect(
      detectPlatformFromUrl("https://careers.cisco.com/global/en/search-results")
    ).toBe("phenom");
    expect(
      detectPlatformFromUrl("https://www.atlassian.com/company/careers/all-jobs?team=Engineering")
    ).toBe("atlassian");
    expect(detectPlatformFromUrl("https://www.atlassian.com/company/careers")).toBe("atlassian");
    expect(detectPlatformFromUrl("https://www.uber.com/global/en/careers/list/")).toBe("uber");
    expect(detectPlatformFromUrl("https://careers.example.com")).toBe("custom");
    expect(detectPlatformFromUrl("https://careers.smartrecruiters.com.example.com/Acme")).toBe("custom");
    expect(detectPlatformFromUrl("https://smartrecruiters.example.com/Acme")).toBe("custom");
    expect(detectPlatformFromUrl("https://jobs.jobvite.com.example.com/acme/jobs")).toBe("custom");
    expect(detectPlatformFromUrl("https://jobs.intuit.com.example.com/search-jobs")).toBe("custom");
    expect(
      detectPlatformFromUrl(
        "https://hdpc.fa.us2.oraclecloud.com.example.com/hcmUI/CandidateExperience/en/sites/acme/jobs"
      )
    ).toBe("custom");
    expect(detectPlatformFromUrl("https://jobs.ebayinc.com.example.com/us/en/search-results")).toBe("custom");
    expect(detectPlatformFromUrl("https://careers.ti.com.example.com/en/sites/CX/jobs")).toBe("custom");
    expect(
      detectPlatformFromUrl("https://careers.cisco.com.example.com/global/en/search-results")
    ).toBe("custom");
  });

  it("is shared by API and UI callers", () => {
    const routeFile = fs.readFileSync(
      path.join(process.cwd(), "lib/application/companies-service.ts"),
      "utf8"
    );
    const formFile = fs.readFileSync(
      path.join(process.cwd(), "components/companies/company-form.tsx"),
      "utf8"
    );

    expect(routeFile).toContain('detectPlatformFromUrl');
    expect(formFile).toContain('detectPlatformFromUrl');
  });
});
