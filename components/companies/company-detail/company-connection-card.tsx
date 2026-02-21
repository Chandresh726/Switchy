"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Linkedin, Star, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { canOpenLinkedInProfile } from "@/lib/connections/message";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";

import type { CompanyConnection } from "./types";

interface CompanyConnectionCardProps {
  connection: CompanyConnection;
  showOutreachBadge?: boolean;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function CompanyConnectionCard({ connection, showOutreachBadge = false }: CompanyConnectionCardProps) {
  const queryClient = useQueryClient();
  const connectedDate = parseDate(connection.connectedOn);

  const patchMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/connections/${connection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update connection");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-overview"] });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/70 px-4 py-3 transition-colors hover:bg-card/90">
      {/* Avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {getInitials(connection.firstName, connection.lastName)}
      </div>

      {/* Name + role + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{connection.fullName}</span>
          {showOutreachBadge && (
            <span className="inline-flex shrink-0 items-center rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
              Suggested
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{connection.position || "Position not listed"}</span>
          {connectedDate && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">Connected {formatRelativeTime(connectedDate)}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {connection.email && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`mailto:${connection.email}`}>
              <Mail className="size-5" />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!canOpenLinkedInProfile(connection.profileUrl)}
          onClick={() => window.open(connection.profileUrl, "_blank", "noopener,noreferrer")}
        >
          <Linkedin className="size-5" />
        </Button>
        <button
          type="button"
          className={cn(
            "rounded-md p-1.5 transition-colors",
            connection.isStarred
              ? "text-yellow-400 hover:text-yellow-300"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => patchMutation.mutate({ isStarred: !connection.isStarred })}
          aria-label={connection.isStarred ? "Unstar connection" : "Star connection"}
        >
          <Star className={cn("h-5 w-5", connection.isStarred && "fill-current")} />
        </button>
      </div>
    </div>
  );
}
