"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PLATFORM_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";

import type { CompanyOverview } from "./types";

interface CompanyHeaderProps {
  company: CompanyOverview;
}

function formatLabel(value: string | null): string {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function CompanyHeader({ company }: CompanyHeaderProps) {
  const lastScrapedDate = parseDate(company.lastScrapedAt);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name}
            className="h-14 w-14 rounded-lg bg-muted p-1.5 object-contain"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-xl font-semibold text-muted-foreground">
            {company.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div>
          <h1 className="text-2xl font-semibold text-foreground">{company.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
                PLATFORM_COLORS[company.platform || "custom"] || PLATFORM_COLORS.custom
              )}
            >
              {formatLabel(company.platform || "custom")}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
                company.isActive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
              )}
            >
              {company.isActive ? "Active" : "Paused"}
            </span>
            {lastScrapedDate && (
              <span className="text-xs text-muted-foreground">
                Last scraped {formatRelativeTime(lastScrapedDate)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={company.careersUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Careers
          </a>
        </Button>
        <Button asChild size="sm">
          <Link href={`/jobs?companyIds=${company.id}`}>View All Jobs</Link>
        </Button>
      </div>
    </div>
  );
}
