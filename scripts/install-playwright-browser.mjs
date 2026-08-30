import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

if (process.env.CI === "true" || process.env.CI === "1") {
  console.log("Skipping Chromium installation in CI");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const playwrightCli = path.join(
  path.dirname(require.resolve("playwright")),
  "cli.js"
);
const installation = spawnSync(
  process.execPath,
  [playwrightCli, "install", "chromium"],
  { stdio: "inherit" }
);

if (installation.error) throw installation.error;
if (installation.status !== 0) process.exit(installation.status ?? 1);
