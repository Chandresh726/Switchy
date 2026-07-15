import {
  MatchEvidenceSchema,
  type MatchBand,
} from "@/lib/ai/artifacts/schemas";

interface MatchPromotionInput {
  matchBand?: MatchBand | null;
  matchLegacy?: boolean;
  matchScore?: number | null;
}

export function isPromotedMatch(input: MatchPromotionInput): boolean {
  if (input.matchBand === "high" || input.matchBand === "good") return true;
  return input.matchLegacy === true &&
    typeof input.matchScore === "number" &&
    input.matchScore >= 70;
}

interface PersistedMatchPromotionRow {
  evidenceJson: string | null;
  legacyScore: number | null;
}

export function countPromotedMatchRows(rows: PersistedMatchPromotionRow[]): number {
  return rows.filter((row) => {
    if (row.evidenceJson) {
      try {
        const evidence = MatchEvidenceSchema.parse(JSON.parse(row.evidenceJson));
        return isPromotedMatch({ matchBand: evidence.matchBand });
      } catch {
        return false;
      }
    }
    return isPromotedMatch({ matchLegacy: true, matchScore: row.legacyScore });
  }).length;
}
