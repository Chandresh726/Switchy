import type { ScreenshotItem } from "@/lib/types";

export const SCREENSHOTS: ScreenshotItem[] = [
  {
    title: "Dashboard",
    description:
      "Your job search at a glance—new jobs, top matches, and recent applications.",
    images: [
      {
        darkSrc: "/screenshots/dashboard-dark.png",
        lightSrc: "/screenshots/dashboard-light.png",
        url: "localhost:3000",
      },
    ],
  },
  {
    title: "Profile",
    description: "Upload your resume and let AI parse your skills and experience.",
    images: [
      {
        darkSrc: "/screenshots/profile-1-dark.png",
        lightSrc: "/screenshots/profile-1-light.png",
        url: "localhost:3000/profile",
      },
      {
        darkSrc: "/screenshots/profile-2-dark.png",
        lightSrc: "/screenshots/profile-2-light.png",
        url: "localhost:3000/profile",
      },
    ],
  },
  {
    title: "Companies",
    description: "Browse and discover companies hiring for your skills.",
    images: [
      {
        darkSrc: "/screenshots/companies-dark.png",
        lightSrc: "/screenshots/companies-light.png",
        url: "localhost:3000/companies",
      },
    ],
  },
  {
    title: "Jobs",
    description: "Filter, sort, and discover opportunities with powerful search tools.",
    images: [
      {
        darkSrc: "/screenshots/jobs-dark.png",
        lightSrc: "/screenshots/jobs-light.png",
        url: "localhost:3000/jobs",
      },
      {
        darkSrc: "/screenshots/job-id-dark.png",
        lightSrc: "/screenshots/job-id-light.png",
        url: "localhost:3000/jobs/{job-id}",
      },
    ],
  },
  {
    title: "AI Writing",
    description:
      "Generate AI-powered cover letters and referral messages tailored to each job.",
    images: [
      {
        darkSrc: "/screenshots/ai-referral-dark.png",
        lightSrc: "/screenshots/ai-referral-light.png",
        url: "localhost:3000/jobs/{job-id}",
      },
      {
        darkSrc: "/screenshots/ai-cover-letter-dark.png",
        lightSrc: "/screenshots/ai-cover-letter-light.png",
        url: "localhost:3000/jobs/{job-id}",
      },
    ],
  },
  {
    title: "History",
    description: "Track all scraping and matching operations with detailed logs.",
    images: [
      {
        darkSrc: "/screenshots/history-scrape-dark.png",
        lightSrc: "/screenshots/history-scrape-light.png",
        url: "localhost:3000/history/scrape",
      },
      {
        darkSrc: "/screenshots/history-matcher-dark.png",
        lightSrc: "/screenshots/history-matcher-light.png",
        url: "localhost:3000/history/match",
      },
    ],
  },
  {
    title: "Settings",
    description:
      "Configure AI providers, scraping schedules, and matching preferences.",
    images: [
      {
        darkSrc: "/screenshots/settings-dark.png",
        lightSrc: "/screenshots/settings-light.png",
        url: "localhost:3000/settings",
      },
    ],
  },
];
