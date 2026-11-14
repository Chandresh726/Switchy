import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const CACHE_MS = 5_000;

// Graphics capability distinguishes full wake from CPU/network-only DarkWake.
// Display sleep does not remove this system capability.
export function parseDeviceWakeState(output: string): boolean | null {
  const capabilities = /^Current System Capabilities are:\s*(.*)$/m.exec(output)?.[1];
  if (!capabilities || !/\bCPU\b/.test(capabilities)) return null;
  return /\bGraphics\b/.test(capabilities) && /\bNetwork\b/.test(capabilities);
}

export function createDeviceWakeCheck(
  platform: NodeJS.Platform = process.platform,
  readState: () => Promise<string> = async () =>
    (await execute("/usr/bin/pmset", ["-g", "systemstate"], { timeout: 2_000 })).stdout
): () => Promise<boolean> {
  let cached: Promise<boolean> | null = null;
  let checkedAt = -Infinity;
  let warned = false;
  return () => {
    if (platform !== "darwin") return Promise.resolve(true);
    if (cached && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < CACHE_MS) return cached;
    checkedAt = Date.now();
    cached = readState().then((output) => {
      const awake = parseDeviceWakeState(output);
      if (awake === null) throw new Error("Unrecognized system capabilities");
      return awake;
    }).catch(() => {
      // A missing OS probe must not disable scraping indefinitely. The leased
      // worker still detects clock gaps and preserves interrupted attempts.
      if (!warned) {
        warned = true;
        console.warn("[Scraper] Could not read device wake state; using clock-gap recovery.");
      }
      return true;
    });
    return cached;
  };
}
