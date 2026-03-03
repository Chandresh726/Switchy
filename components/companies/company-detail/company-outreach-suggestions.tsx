"use client";

import { Lightbulb } from "lucide-react";

import { isRecruiterPosition } from "@/lib/people/position";

import { CompanyPersonCard } from "./company-person-card";

import type { CompanyPerson } from "./types";

interface CompanyOutreachSuggestionsProps {
  people: CompanyPerson[];
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

function getOutreachScore(person: CompanyPerson): number {
  let score = 0;

  if (person.isStarred) score += 10;
  if (isRecruiterPosition(person.position)) score += 8;

  if (person.position) {
    const positionLower = person.position.toLowerCase();
    for (const [keyword, value] of Object.entries(SENIORITY_KEYWORDS)) {
      if (positionLower.includes(keyword)) {
        score += value;
        break;
      }
    }
  }

  if (person.email) score += 2;

  return score;
}

export function CompanyOutreachSuggestions({ people }: CompanyOutreachSuggestionsProps) {
  const suggestedPeople = [...people]
    .map((person) => ({ ...person, _score: getOutreachScore(person) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  if (suggestedPeople.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-medium text-foreground">Outreach Suggestions</h3>
        <span className="text-xs text-muted-foreground">
          Best people for referral requests
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {suggestedPeople.map((person) => (
          <CompanyPersonCard
            key={person.id}
            person={person}
            showOutreachBadge
          />
        ))}
      </div>
    </div>
  );
}
