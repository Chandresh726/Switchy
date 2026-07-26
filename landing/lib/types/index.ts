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

export interface PlatformItem {
  name: string;
  logo: string;
}

export interface InstallationStep {
  step: string;
  title: string;
  description: string;
  code: string;
}
