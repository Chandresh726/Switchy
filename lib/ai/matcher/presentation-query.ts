import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "@/lib/db";
import { jobs, matchResults } from "@/lib/db/schema";

interface PreferredMatchContext {
  candidateFingerprint: string;
}

// Indexed probes avoid ranking the entire match ledger for every list request.
// Both probes share a stable order with detail presentation.
export function buildPreferredMatchResultId(context: PreferredMatchContext | null) {
  const candidate = alias(matchResults, "presentation_candidate");
  const latest = db.select({ id: candidate.id }).from(candidate)
    .where(eq(candidate.jobId, jobs.id))
    .orderBy(desc(candidate.createdAt), desc(candidate.id)).limit(1);
  if (!context) return latest;
  const fresh = db.select({ id: candidate.id }).from(candidate).where(and(
    eq(candidate.jobId, jobs.id),
    eq(candidate.candidateFingerprint, context.candidateFingerprint),
    eq(candidate.isStale, false)
  )).orderBy(desc(candidate.createdAt), desc(candidate.id)).limit(1);
  return sql<string | null>`coalesce((${fresh}), (${latest}))`;
}
