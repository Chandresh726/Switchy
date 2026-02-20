import type { FAQItem } from "@/lib/types";

export const FAQS: FAQItem[] = [
  {
    question: "Is Switchy free to use?",
    answer:
      "Yes. Switchy is open source and free to run locally. If you use AI features, you only pay your selected provider for API usage.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "Your data stays on your machine using local storage (SQLite and local files). No cloud account is required.",
  },
  {
    question: "Which job boards does Switchy support?",
    answer:
      "Switchy supports Greenhouse, Lever, Ashby, Workday, and Eightfold job platforms.",
  },
  {
    question: "Do I need an AI API key?",
    answer:
      "Only for AI features. Scraping and tracking work locally, and AI capabilities (like matching, cover letters, and referral messages) use your own provider API key.",
  },
  {
    question: "How do I get started?",
    answer:
      "Follow the setup steps above: clone the repo, run pnpm install, then run pnpm build && pnpm start. Add an AI provider key when you want to enable AI features.",
  },
];
