import type { FAQItem } from "@/lib/types";

export const FAQS: FAQItem[] = [
  {
    question: "Is Switchy free to use?",
    answer:
      "Yes, Switchy is completely free and open source. You only pay for the AI API keys you choose to use (like OpenAI or Anthropic).",
  },
  {
    question: "Where is my data stored?",
    answer:
      "All your data is stored locally on your machine in a SQLite database. Nothing is sent to the cloud unless you explicitly configure it.",
  },
  {
    question: "Which job boards does Switchy support?",
    answer:
      "Switchy currently supports Greenhouse, Lever, and Ashby job boards. We're working on adding more platforms in future updates.",
  },
  {
    question: "Do I need an AI API key?",
    answer:
      "Yes, you'll need an API key from one of the supported providers (OpenAI, Anthropic, Google Gemini, etc.) to use AI features like matching and content generation.",
  },
  {
    question: "How do I get started?",
    answer:
      "Simply clone the repository, install dependencies with pnpm, configure your .env file with API keys, and run pnpm build && pnpm start. The Setup section above has detailed instructions.",
  },
];
