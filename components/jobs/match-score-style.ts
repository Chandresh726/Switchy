type MatchScoreTier = "strong" | "good" | "moderate" | "fair" | "weak";

function getMatchScoreTier(score: number): MatchScoreTier {
  if (score >= 75) return "strong";
  if (score >= 60) return "good";
  if (score >= 45) return "moderate";
  if (score >= 30) return "fair";
  return "weak";
}

export function getMatchScoreLabel(score: number): string {
  switch (getMatchScoreTier(score)) {
    case "strong":
      return "Strong";
    case "good":
      return "Good";
    case "moderate":
      return "Moderate";
    case "fair":
      return "Fair";
    case "weak":
      return "Weak";
  }
}

/** Badge pill classes: background, text, and border. */
export function getMatchScoreBadgeClass(score: number): string {
  switch (getMatchScoreTier(score)) {
    case "strong":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "good":
      return "bg-green-500/10 text-green-400 border-green-500/30";
    case "moderate":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
    case "fair":
      return "bg-orange-500/10 text-orange-400 border-orange-500/30";
    case "weak":
      return "bg-red-500/10 text-red-400 border-red-500/30";
  }
}

/** Progress bar fill color. */
export function getMatchScoreBarFillClass(score: number): string {
  switch (getMatchScoreTier(score)) {
    case "strong":
      return "bg-emerald-500";
    case "good":
      return "bg-green-500";
    case "moderate":
      return "bg-yellow-500";
    case "fair":
      return "bg-orange-500";
    case "weak":
      return "bg-red-500";
  }
}

/** Text accent matching the score tier. */
export function getMatchScoreTextClass(score: number): string {
  switch (getMatchScoreTier(score)) {
    case "strong":
      return "text-emerald-400";
    case "good":
      return "text-green-400";
    case "moderate":
      return "text-yellow-400";
    case "fair":
      return "text-orange-400";
    case "weak":
      return "text-red-400";
  }
}
