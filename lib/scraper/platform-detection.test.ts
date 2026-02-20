import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";

describe("platform detection", () => {
  it("detects known platforms from careers URLs", () => {
    expect(detectPlatformFromUrl("https://boards.greenhouse.io/acme")).toBe("greenhouse");
    expect(detectPlatformFromUrl("https://jobs.lever.co/acme")).toBe("lever");
    expect(detectPlatformFromUrl("https://jobs.ashbyhq.com/acme")).toBe("ashby");
    expect(detectPlatformFromUrl("https://acme.wd5.myworkdayjobs.com/en-US/careers")).toBe("workday");
    expect(detectPlatformFromUrl("https://acme.eightfold.ai/careers")).toBe("eightfold");
    expect(detectPlatformFromUrl("https://www.uber.com/global/en/careers/list/")).toBe("uber");
    expect(detectPlatformFromUrl("https://careers.example.com")).toBe("custom");
  });

  it("is shared by API and UI callers", () => {
    const routeFile = fs.readFileSync(
      path.join(process.cwd(), "app/api/companies/route.ts"),
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
