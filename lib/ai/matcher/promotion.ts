interface MatchPromotionInput {
  matchScore?: number | null;
}

export function isPromotedMatch(input: MatchPromotionInput): boolean {
  return typeof input.matchScore === "number" && input.matchScore >= 70;
}

interface PersistedMatchPromotionRow {
  score?: number | null;
  legacyScore: number | null;
}

export function countPromotedMatchRows(rows: PersistedMatchPromotionRow[]): number {
  return rows.filter((row) =>
    isPromotedMatch({ matchScore: row.score ?? row.legacyScore })
  ).length;
}
