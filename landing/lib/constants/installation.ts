import type { InstallationStep } from "@/lib/types";

export const INSTALL_COMMAND = "npx @chandresh726/switchy@latest start";

export const SOURCE_INSTALL_STEPS: InstallationStep[] = [
  {
    step: "1",
    title: "Clone the Repository",
    description: "Get the latest source code from GitHub.",
    code: "git clone https://github.com/Chandresh726/Switchy.git switchy && cd switchy",
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
