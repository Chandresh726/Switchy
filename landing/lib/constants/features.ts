import type { FeatureItem } from "@/lib/types";
import { Brain, Clock, Search, Send, Shield, Zap } from "lucide-react";

export const FEATURES: FeatureItem[] = [
  {
    icon: Search,
    title: "Smart Scraping",
    description:
      "Auto-discover jobs from Greenhouse, Lever, and Ashby job boards with intelligent deduplication.",
    color: "green",
  },
  {
    icon: Brain,
    title: "AI Match Scores",
    description:
      "Resume-to-job matching with detailed reasoning, matched skills, and personalized recommendations.",
    color: "green-light",
  },
  {
    icon: Send,
    title: "Cover Letters & Referrals",
    description:
      "AI-generated cover letters and referral messages tailored to each job and your profile.",
    color: "green",
  },
  {
    icon: Zap,
    title: "Multi-Provider AI",
    description:
      "Support for Anthropic, OpenAI, Gemini, Cerebras, Groq, OpenRouter, Modal, and NVIDIA NIM.",
    color: "green-light",
  },
  {
    icon: Clock,
    title: "Automated Scheduling",
    description: "Cron-based scraping that runs automatically—set it and forget it.",
    color: "green",
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description:
      "Your data stays on your machine. SQLite database with local file storage—no cloud required.",
    color: "green-light",
  },
];

export const FEATURE_COLORS: Record<string, string> = {
  green: "bg-[#10b981] text-black",
  "green-light": "bg-[#34d399] text-black",
};
