import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";

const CONFIRMATION_MIN_MS = 60_000;
const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const ARCHIVABLE = new Set(["new", "viewed", "interested", "rejected"]);

export function canArchiveMissingJobs(input: {
  companyId: number;
  source: string;
  complete: boolean;
  openIds: string[];
  existing: ExistingJob[];
  now: Date;
  state?: ScrapeFetchStateStore;
}): { allowed: boolean; warning?: string } {
  const key = `archive-confirmation:${input.companyId}`;
  if (!input.complete) {
    input.state?.delete(key);
    return { allowed: false };
  }
  const open = new Set(input.openIds);
  const eligible = input.existing.filter((job) => job.externalId && ARCHIVABLE.has(job.status));
  const missing = eligible.filter((job) => !open.has(job.externalId!)).map((job) => job.externalId!).sort();
  if (missing.length <= Math.max(5, Math.ceil(eligible.length * 0.05))) {
    input.state?.delete(key);
    return { allowed: true };
  }
  const signature = JSON.stringify([input.source, missing]);
  const previous = input.state?.get(key);
  if (previous && typeof previous === "object" && "signature" in previous &&
      previous.signature === signature && "at" in previous && typeof previous.at === "number") {
    const age = input.now.getTime() - previous.at;
    if (age >= CONFIRMATION_MIN_MS && age < CONFIRMATION_TTL_MS) {
      input.state?.delete(key);
      return { allowed: true };
    }
    if (age >= 0 && age < CONFIRMATION_MIN_MS) return { allowed: false, warning: "Archival awaits a second complete listing at least one minute later." };
  }
  input.state?.set(key, { signature, at: input.now.getTime() }, new Date(input.now.getTime() + CONFIRMATION_TTL_MS));
  return { allowed: false, warning: `Archival paused: ${missing.length} previously open jobs were absent. Another complete listing must confirm this change.` };
}
