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
      "With Node.js 24 installed, run npx @chandresh726/switchy@latest start. Switchy downloads the correct runtime and starts locally; source installation remains available above for contributors.",
  },
];
