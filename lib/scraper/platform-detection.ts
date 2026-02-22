import type { Platform } from "@/lib/scraper/types";

export type DetectedPlatform = Platform | "custom";

export function detectPlatformFromUrl(url: string): DetectedPlatform {
  const urlLower = url.toLowerCase();

  if (urlLower.includes("google.com/about/careers/applications/jobs")) {
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
  if (urlLower.includes("eightfold.ai")) {
    return "eightfold";
  }
  if (
    urlLower.includes("atlassian.com/company/careers/all-jobs") ||
    urlLower.includes("atlassian.com/company/careers/details")
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
  return "custom";
}

export function getPlatformLabel(platform: DetectedPlatform): string {
  const labels: Record<DetectedPlatform, string> = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    eightfold: "Eightfold",
    workday: "Workday",
    uber: "Uber",
    google: "Google",
    atlassian: "Atlassian",
    custom: "Custom",
  };

  return labels[platform];
}
