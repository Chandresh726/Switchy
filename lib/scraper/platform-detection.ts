import { PLATFORMS, PLATFORM_METADATA, type Platform } from "@/lib/companies/platforms";

export type DetectedPlatform = Platform | "custom";

type SourceUrl = { hostname: string; pathname: string };
const hostIs = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
const matches: Record<Platform, (source: SourceUrl) => boolean> = {
  greenhouse: ({ hostname }) => hostIs(hostname, "greenhouse.io"),
  smartrecruiters: ({ hostname }) => ["careers.smartrecruiters.com", "jobs.smartrecruiters.com"].includes(hostname),
  lever: ({ hostname }) => hostIs(hostname, "lever.co"),
  ashby: ({ hostname }) => hostIs(hostname, "ashbyhq.com"),
  eightfold: ({ hostname }) => hostIs(hostname, "eightfold.ai"),
  workday: ({ hostname }) => hostIs(hostname, "myworkdayjobs.com"),
  servicenow: ({ hostname, pathname }) => hostname === "careers.servicenow.com" && pathname.startsWith("/jobs"),
  turbohire: ({ hostname, pathname }) => (
    hostname.endsWith(".turbohire.co") &&
    /^\/careerpage\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/u.test(pathname)
  ) || (hostIs(hostname, "flipkartcareers.com") && pathname.includes("/flipkart/jobslist")),
  mynexthire: ({ hostname }) => hostname.endsWith(".mynexthire.com") || hostname === "careers.swiggy.com",
  uber: ({ hostname, pathname }) => hostname === "jobs.uber.com" || (hostIs(hostname, "uber.com") && pathname.includes("career")),
  google: ({ hostname, pathname }) => hostname === "careers.google.com" || (hostIs(hostname, "google.com") && pathname.startsWith("/about/careers")),
  atlassian: ({ hostname, pathname }) => hostIs(hostname, "atlassian.com") && pathname.startsWith("/company/careers"),
  rippling: ({ hostname, pathname }) => hostIs(hostname, "rippling.com") && pathname.includes("career"),
  jobvite: ({ hostname }) => hostname === "jobs.jobvite.com" || hostname === "careers.nutanix.com",
  talentbrew: ({ hostname }) => hostname === "jobs.intuit.com" || hostname === "careers.intuit.com",
  oracle: ({ hostname, pathname }) => (
    hostname.endsWith(".oraclecloud.com") && pathname.includes("/hcmui/candidateexperience/")
  ) || ["careers.oracle.com", "careers.ti.com", "higher.gs.com"].includes(hostname),
  phenom: ({ hostname }) => ["jobs.ebayinc.com", "careers.cisco.com"].includes(hostname),
};

export function detectPlatformFromUrl(url: string): DetectedPlatform {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "custom";
    const source = { hostname: parsed.hostname.toLowerCase(), pathname: parsed.pathname.toLowerCase() };
    return PLATFORMS.find((platform) => matches[platform](source)) ?? "custom";
  } catch {
    return "custom";
  }
}

export function getPlatformLabel(platform: DetectedPlatform): string {
  return PLATFORM_METADATA[platform].label;
}
