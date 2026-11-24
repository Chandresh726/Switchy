import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@/lib/db/schema";

type ScoredJob = typeof schema.jobs.$inferInsert & {
  matchScore?: number | null;
  matchReasons?: string | null;
  matchedSkills?: string | null;
  missingSkills?: string | null;
  recommendations?: string | null;
};

// Seed scores in the authoritative result ledger, including older-source cases.
export function insertJobsWithMatches(database: BetterSQLite3Database<typeof schema>, input: ScoredJob | ScoredJob[]) {
  const values = Array.isArray(input) ? input : [input];
  const rows = database.insert(schema.jobs).values(values.map((value) => {
    const { matchScore, matchReasons, matchedSkills, missingSkills, recommendations, ...job } = value;
    void matchScore; void matchReasons; void matchedSkills; void missingSkills; void recommendations;
    return job;
  })).returning().all();
  rows.forEach((job, index) => {
    const score = values[index].matchScore;
    if (score === null || score === undefined) return;
    database.insert(schema.matchResults).values({
      id: `fixture:${job.id}`,
      jobId: job.id, candidateFingerprint: "fixture-candidate", jobFingerprint: `fixture-job:${job.id}`,
      scoringPolicyVersion: "fixture-policy", score, source: "legacy", isStale: true,
      breakdownJson: JSON.stringify({ skillsAndTechnologies: score }),
      evidenceJson: JSON.stringify({ summary: "Fixture result", reasoning: [], matchedSkills: [] }),
      confidence: 0,
    }).run();
  });
  return rows;
}
