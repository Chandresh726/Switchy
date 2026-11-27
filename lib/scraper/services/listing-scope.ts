import { z } from "zod";

import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";
import type { ExistingJob } from "@/lib/scraper/infrastructure/types";

const membershipSchema = z.object({ source: z.string(), openIds: z.array(z.string()) });

interface ListingScope {
  existing: ExistingJob[];
  canArchive: boolean;
  candidateExternalIds?: string[];
  commit(archivedMissing?: boolean): void;
}

/** A scoped crawl can only archive jobs previously observed in that scope. */
export function prepareListingScope(input: {
  companyId: number;
  scopeKey?: string;
  existing: ExistingJob[];
  openIds: string[];
  complete: boolean;
  now: Date;
  state?: ScrapeFetchStateStore;
}): ListingScope {
  if (!input.scopeKey) return {
    existing: input.existing, canArchive: true,
    candidateExternalIds: undefined,
    commit: () => {},
  };
  const key = `listing-membership:${input.companyId}:${input.scopeKey}`;
  let previous: z.infer<typeof membershipSchema> | undefined;
  try { previous = membershipSchema.safeParse(input.state?.get(key)).data; }
  catch { /* A missing or unreadable baseline cannot authorize archival. */ }
  const ids = new Set(previous?.source === input.scopeKey ? previous.openIds : []);
  return {
    existing: input.existing.filter((job) => job.externalId && ids.has(job.externalId)),
    canArchive: previous?.source === input.scopeKey,
    candidateExternalIds: [...ids],
    commit: (archivedMissing = false) => {
      if (!input.complete || !input.state) return;
      try {
        // Keep missing members while the disappearance confirmation is pending.
        // Otherwise the next complete snapshot would forget what it must confirm.
        const members = archivedMissing ? input.openIds : [...ids, ...input.openIds];
        input.state.set(key, { source: input.scopeKey, openIds: [...new Set(members)] },
          new Date(input.now.getTime() + 30 * 24 * 60 * 60_000));
      } catch (error) {
        console.warn("Could not save listing scope membership; archival will remain conservative:", error);
      }
    },
  };
}
