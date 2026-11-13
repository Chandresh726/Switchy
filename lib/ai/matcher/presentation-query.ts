import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { jobs, matchResults } from "@/lib/db/schema";

interface PreferredMatchContext {
  candidateFingerprint: string;
}

export function buildPreferredMatchResultsQuery(
  context: PreferredMatchContext | null,
  companyId?: number
) {
  const currentCandidatePriority = context
    ? sql`case when ${matchResults.candidateFingerprint} = ${context.candidateFingerprint}
        and ${matchResults.isStale} = 0 then 0 else 1 end`
    : sql`0`;

  return db.select({
    jobId: matchResults.jobId,
    score: matchResults.score,
    presentationRank: sql<number>`row_number() over (
      partition by ${matchResults.jobId}
      order by ${currentCandidatePriority},
        ${matchResults.createdAt} desc,
        ${matchResults.id} desc
    )`.as("presentation_rank"),
  }).from(matchResults).where(companyId === undefined ? undefined : inArray(
    matchResults.jobId,
    db.select({ id: jobs.id }).from(jobs).where(eq(jobs.companyId, companyId))
  )).as("preferred_match_results");
}
