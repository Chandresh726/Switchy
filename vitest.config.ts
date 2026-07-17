import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    coverage: {
      provider: "v8",
      include: [
        "app/**/*.tsx",
        "app/api/**/*.ts",
        "components/**/*.{ts,tsx}",
        "lib/ai/**/*.ts",
        "lib/api/**/*.ts",
        "lib/application/**/*.ts",
        "lib/companies/**/*.ts",
        "lib/db/**/*.ts",
        "lib/jobs/**/*.ts",
        "lib/hooks/**/*.ts",
        "lib/people/**/*.ts",
        "lib/runtime/**/*.ts",
        "lib/scraper/**/*.ts",
        "lib/settings/**/*.ts",
        "lib/state/**/*.ts",
        "lib/storage/**/*.ts",
        "lib/query-keys.ts",
      ],
      exclude: ["lib/**/index.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/node.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/setup/node.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.tsx"],
          setupFiles: ["tests/setup/ui.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "eval",
          environment: "node",
          include: ["tests/evals/**/*.test.ts"],
          setupFiles: ["tests/setup/node.ts"],
        },
      },
    ],
  },
});
