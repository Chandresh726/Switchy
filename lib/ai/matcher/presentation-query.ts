import { getTableColumns, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { matchResults } from "@/lib/db/schema";

interface PreferredMatchContext {
  candidateFingerprint: string;
}

export function buildPreferredMatchResultsQuery(
  context: PreferredMatchContext | null
) {
  const currentCandidatePriority = context
    ? sql`case when ${matchResults.candidateFingerprint} = ${context.candidateFingerprint}
        and ${matchResults.isStale} = 0 then 0 else 1 end`
    : sql`0`;

  return db.select({
    ...getTableColumns(matchResults),
    presentationRank: sql<number>`row_number() over (
      partition by ${matchResults.jobId}
      order by ${currentCandidatePriority},
        ${matchResults.createdAt} desc,
        ${matchResults.id} desc
    )`.as("presentation_rank"),
  }).from(matchResults).as("preferred_match_results");
}
