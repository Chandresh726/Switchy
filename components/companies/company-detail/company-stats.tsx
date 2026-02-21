"use client";

import { Briefcase, Sparkles, Users, Star } from "lucide-react";

import { cn } from "@/lib/utils";

import type { CompanyStats } from "./types";

interface CompanyStatsProps {
  stats: CompanyStats;
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  iconClassName?: string;
}

function StatCard({ label, value, icon: Icon, iconClassName }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-md bg-muted", iconClassName)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function CompanyStats({ stats }: CompanyStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Open Jobs"
        value={stats.openJobs}
        icon={Briefcase}
        iconClassName="text-blue-400"
      />
      <StatCard
        label="High Matches"
        value={stats.highMatchJobs}
        icon={Sparkles}
        iconClassName="text-emerald-400"
      />
      <StatCard
        label="Connections"
        value={stats.mappedConnections}
        icon={Users}
        iconClassName="text-purple-400"
      />
      <StatCard
        label="Starred"
        value={stats.starredConnections}
        icon={Star}
        iconClassName="text-yellow-400"
      />
    </div>
  );
}
