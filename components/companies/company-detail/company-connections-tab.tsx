"use client";

import { UserRound } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

import { CompanyConnectionCard } from "./company-connection-card";
import { CompanyOutreachSuggestions } from "./company-outreach-suggestions";

import type { CompanyConnection } from "./types";

interface CompanyConnectionsTabProps {
  connections: CompanyConnection[];
}

export function CompanyConnectionsTab({ connections }: CompanyConnectionsTabProps) {
  if (connections.length === 0) {
    return (
      <EmptyState
        icon={UserRound}
        title="No connections mapped"
        description="Import your LinkedIn connections and map this company to see warm intros here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <CompanyOutreachSuggestions connections={connections} />

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          All Connections ({connections.length})
        </h3>
        <div className="flex flex-col gap-2">
          {connections.map((connection) => (
            <CompanyConnectionCard key={connection.id} connection={connection} />
          ))}
        </div>
      </div>
    </div>
  );
}
