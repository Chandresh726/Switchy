"use client";

import { Lightbulb } from "lucide-react";

import { CompanyConnectionCard } from "./company-connection-card";

import type { CompanyConnection } from "./types";

interface CompanyOutreachSuggestionsProps {
  connections: CompanyConnection[];
}

const SENIORITY_KEYWORDS: Record<string, number> = {
  director: 5,
  vp: 5,
  vice: 5,
  head: 4,
  lead: 4,
  principal: 4,
  senior: 3,
  manager: 3,
  staff: 3,
  engineer: 2,
  developer: 2,
};

function getOutreachScore(connection: CompanyConnection): number {
  let score = 0;

  if (connection.isStarred) score += 10;

  if (connection.position) {
    const positionLower = connection.position.toLowerCase();
    for (const [keyword, value] of Object.entries(SENIORITY_KEYWORDS)) {
      if (positionLower.includes(keyword)) {
        score += value;
        break;
      }
    }
  }

  if (connection.email) score += 2;

  return score;
}

export function CompanyOutreachSuggestions({ connections }: CompanyOutreachSuggestionsProps) {
  const suggestedConnections = [...connections]
    .map((conn) => ({ ...conn, _score: getOutreachScore(conn) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  if (suggestedConnections.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-medium text-foreground">Outreach Suggestions</h3>
        <span className="text-xs text-muted-foreground">
          Best connections for referral requests
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {suggestedConnections.map((connection) => (
          <CompanyConnectionCard
            key={connection.id}
            connection={connection}
            showOutreachBadge
          />
        ))}
      </div>
    </div>
  );
}
