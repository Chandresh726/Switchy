import type { StepItem } from "@/lib/types";
import { Building2, Send, Sparkles, UserRound } from "lucide-react";

export const STEPS: StepItem[] = [
  {
    number: "01",
    icon: Building2,
    title: "Add Your Companies",
    description:
      "Track companies you're interested in. Add their job board URLs and let Switchy handle the rest.",
  },
  {
    number: "02",
    icon: UserRound,
    title: "Upload Your Resume",
    description:
      "Upload your resume and let AI parse your skills, experience, and education automatically.",
  },
  {
    number: "03",
    icon: Sparkles,
    title: "Let AI Do the Work",
    description:
      "Switchy scrapes jobs, matches them to your profile, and calculates match scores automatically.",
  },
  {
    number: "04",
    icon: Send,
    title: "Apply with Confidence",
    description:
      "Review top matches, generate personalized cover letters, and track your applications.",
  },
];
