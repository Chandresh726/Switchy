import type { LucideIcon } from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
}

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface StepItem {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface ProviderItem {
  name: string;
  logo: string;
}

export interface ScreenshotImage {
  src: string;
  url: string;
}

export interface ScreenshotItem {
  images: ScreenshotImage[];
  title: string;
  description: string;
}

export interface SetupStep {
  step: string;
  title: string;
  description: string;
  code: string;
}
