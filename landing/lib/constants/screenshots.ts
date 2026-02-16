import type { ScreenshotItem } from "@/lib/types";

export const SCREENSHOTS: ScreenshotItem[] = [
  {
    title: "Dashboard",
    description:
      "Your job search at a glance—new jobs, top matches, and recent applications.",
    images: [
      {
        src: "/screenshots/dashboard.png",
        url: "localhost:3000",
      },
    ],
  },
  {
    title: "Profile",
    description: "Upload your resume and let AI parse your skills and experience.",
    images: [
      {
        src: "/screenshots/profile-1.png",
        url: "localhost:3000/profile",
      },
      {
        src: "/screenshots/profile-2.png",
        url: "localhost:3000/profile",
      },
    ],
  },
  {
    title: "Companies",
    description: "Browse and discover companies hiring for your skills.",
    images: [
      {
        src: "/screenshots/companies.png",
        url: "localhost:3000/companies",
      },
    ],
  },
  {
    title: "Jobs",
    description: "Filter, sort, and discover opportunities with powerful search tools.",
    images: [
      {
        src: "/screenshots/jobs.png",
        url: "localhost:3000/jobs",
      },
      {
        src: "/screenshots/job-id.png",
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
        src: "/screenshots/ai-referral.png",
        url: "localhost:3000/jobs/{job-id}",
      },
      {
        src: "/screenshots/ai-cover-letter.png",
        url: "localhost:3000/jobs/{job-id}",
      },
    ],
  },
  {
    title: "History",
    description: "Track all scraping and matching operations with detailed logs.",
    images: [
      {
        src: "/screenshots/history-scrape.png",
        url: "localhost:3000/history/scrape",
      },
      {
        src: "/screenshots/history-matcher.png",
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
        src: "/screenshots/settings.png",
        url: "localhost:3000/settings",
      },
    ],
  },
];
