interface MatchPromotionInput {
  matchScore?: number | null;
}

export function isPromotedMatch(input: MatchPromotionInput): boolean {
  return typeof input.matchScore === "number" && input.matchScore >= 70;
}
