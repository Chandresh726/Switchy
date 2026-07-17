import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "instrumentation.ts",
      "lib/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@test/*"],
              message: "Production modules cannot import test-only code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "app/(dashboard)/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/hooks/**/*.{ts,tsx}",
      "lib/**/use-*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@test/*"],
              message: "Production modules cannot import test-only code.",
            },
            {
              group: ["@/lib/api/client"],
              message: "UI modules must use a typed feature client from lib/api/clients.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "coverage/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate Next.js app (landing page)
    "landing/**",
  ]),
]);

export default eslintConfig;
