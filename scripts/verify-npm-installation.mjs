import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 15_000;
const INSTALLATION_BUDGET_MS = 180_000;

export async function verifyNpmInstallation(name, version) {
  const specifier = `${name}@${version}`;
  const deadline = Date.now() + INSTALLATION_BUDGET_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const installation = spawnSync("pnpm", [
      "--config.verify-deps-before-run=false", "--reporter=silent",
      "dlx", specifier, "version",
    ], {
      cwd: process.env.RUNNER_TEMP,
      encoding: "utf8",
      timeout: Math.min(120_000, Math.max(1, deadline - Date.now())),
    });
    if (installation.error) throw installation.error;
    if (installation.status === 0) {
      assert.equal(installation.stdout.trim(), version, "Installed CLI reports the wrong version");
      return;
    }

    const output = `${installation.stderr ?? ""}\n${installation.stdout ?? ""}`;
    const awaitingPublication = output.includes("ERR_PNPM_NO_MATCHING_VERSION")
      && /No matching version found for (\S+)/.exec(output)?.[1] === specifier;
    if (!awaitingPublication || attempt === MAX_ATTEMPTS || Date.now() + RETRY_DELAY_MS >= deadline) {
      assert.fail(`Failed to verify installed ${specifier} after ${attempt} attempt(s):\n${output}`);
    }
    console.warn(
      `npm has not propagated ${specifier} to the installer yet; `
      + `retrying in 15 seconds (attempt ${attempt}/${MAX_ATTEMPTS}).`
    );
    await setTimeout(RETRY_DELAY_MS);
  }
}
