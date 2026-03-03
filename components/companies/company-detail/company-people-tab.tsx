"use client";

import { UserRound } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { isRecruiterPosition } from "@/lib/people/position";

import { CompanyPersonCard } from "./company-person-card";
import { CompanyOutreachSuggestions } from "./company-outreach-suggestions";

import type { CompanyPerson } from "./types";

interface CompanyPeopleTabProps {
  people: CompanyPerson[];
}

export function CompanyPeopleTab({ people }: CompanyPeopleTabProps) {
  if (people.length === 0) {
    return (
      <EmptyState
        icon={UserRound}
        title="No people mapped"
        description="Import people and map this company to see warm intros here."
      />
    );
  }

  const recruiters = people.filter((person) => isRecruiterPosition(person.position));
  const others = people.filter((person) => !recruiters.some((recruiter) => recruiter.id === person.id));

  return (
    <div className="space-y-6">
      <CompanyOutreachSuggestions people={people} />

      {recruiters.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Recruiters ({recruiters.length})
          </h3>
          <div className="flex flex-col gap-2">
            {recruiters.map((person) => (
              <CompanyPersonCard key={person.id} person={person} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          All People ({people.length})
        </h3>
        <div className="flex flex-col gap-2">
          {others.map((person) => (
            <CompanyPersonCard key={person.id} person={person} />
          ))}
        </div>
      </div>
    </div>
  );
}
