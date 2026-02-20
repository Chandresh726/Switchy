import type { SetupStep } from "@/lib/types";

export const SETUP_STEPS: SetupStep[] = [
  {
    step: "1",
    title: "Clone the Repository",
    description: "Get the latest source code from GitHub.",
    code: "git clone https://github.com/Chandresh726/Switchy.git && cd switchy",
  },
  {
    step: "2",
    title: "Install Dependencies",
    description: "Use pnpm to install all required packages.",
    code: "pnpm install",
  },
  {
    step: "3",
    title: "Build & Start",
    description: "Build the app and start the production server.",
    code: "pnpm build && pnpm start",
  },
];
