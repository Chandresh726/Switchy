import type { Platform } from "@/lib/scraper/types";

export type DetectedPlatform = Platform | "custom";

export function detectPlatformFromUrl(url: string): DetectedPlatform {
  const urlLower = url.toLowerCase();

  if (
    urlLower.includes("google.com/about/careers/applications/jobs") ||
    urlLower.includes("google.com/about/careers") ||
    urlLower.includes("careers.google.com")
  ) {
    return "google";
  }
  if (urlLower.includes("greenhouse.io") || urlLower.includes("boards.greenhouse")) {
    return "greenhouse";
  }
  if (urlLower.includes("lever.co") || urlLower.includes("jobs.lever")) {
    return "lever";
  }
  if (urlLower.includes("ashbyhq.com") || urlLower.includes("jobs.ashbyhq.com")) {
    return "ashby";
  }
  if (urlLower.includes("myworkdayjobs.com") || /\.wd\d*\.myworkdayjobs\.com/.test(urlLower)) {
    return "workday";
  }
  if (
    urlLower.includes("careers.servicenow.com/jobs") ||
    (urlLower.includes("servicenow.com") && urlLower.includes("/jobs/"))
  ) {
    return "servicenow";
  }
  if (
    urlLower.includes(".mynexthire.com") ||
    urlLower.includes("careers.swiggy.com")
  ) {
    return "mynexthire";
  }
  if (
    urlLower.includes(".zwayam.com") ||
    urlLower.includes("public.zwayam.com") ||
    urlLower.includes("flipkartcareers.com/flipkart/jobslist")
  ) {
    return "zwayam";
  }
  if (urlLower.includes("eightfold.ai")) {
    return "eightfold";
  }
  if (
    urlLower.includes("atlassian.com/company/careers/all-jobs") ||
    urlLower.includes("atlassian.com/company/careers/details") ||
    urlLower.includes("atlassian.com/company/careers")
  ) {
    return "atlassian";
  }
  if (
    urlLower.includes("uber.com/careers") ||
    urlLower.includes("jobs.uber.com") ||
    (urlLower.includes("uber.com") && urlLower.includes("career"))
  ) {
    return "uber";
  }
  if (
    urlLower.includes("rippling.com/careers/open-roles") ||
    urlLower.includes("rippling.com/careers") ||
    (urlLower.includes("rippling.com") && urlLower.includes("career"))
  ) {
    return "rippling";
  }
  if (urlLower.includes("/jobs")) {
    try {
      const hostname = new URL(urlLower).hostname;
      if (hostname === "visa.com" || hostname === "www.visa.com" ||
          hostname.endsWith(".visa.com") || hostname.endsWith(".visa.co.uk")) {
        return "visa";
      }
    } catch {
      // fall through
    }
  }
  if (urlLower.includes("careers.nutanix.com") || urlLower.includes("nutanix.com") && urlLower.includes("career")) {
    return "nutanix";
  }
  return "custom";
}

export function getPlatformLabel(platform: DetectedPlatform): string {
  const labels: Record<DetectedPlatform, string> = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    eightfold: "Eightfold",
    workday: "Workday",
    servicenow: "ServiceNow",
    zwayam: "Zwayam",
    mynexthire: "MynextHire",
    uber: "Uber",
    google: "Google",
    atlassian: "Atlassian",
    rippling: "Rippling",
    visa: "Visa",
    nutanix: "Nutanix",
    custom: "Custom",
  };

  return labels[platform];
}
