"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Star,
  TrendingUp,
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  Zap,
  ArrowRight,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { MatchBadge } from "@/components/jobs/match-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ScrapeSession {
  id: string;
  triggerSource: string;
  status: string;
  companiesTotal: number;
  companiesCompleted: number;
  totalJobsFound: number;
  totalJobsAdded: number;
  startedAt: string;
  completedAt: string | null;
}

interface Stats {
  totalJobs: number;
  totalCompanies: number;
  highMatchJobs: number;
  appliedJobs: number;
  newJobs: number;
  viewedJobs: number;
  savedJobs: number;
  jobsWithScore: number;
  lastScan: ScrapeSession | null;
}

interface Profile {
  id: number;
  name: string;
}

interface Job {
  id: number;
  title: string;
  url: string;
  location: string | null;
  locationType: string | null;
  matchScore: number | null;
  status: string;
  discoveredAt: string;
  appliedAt: string | null;
  company: {
    id: number;
    name: string;
    logoUrl: string | null;
  };
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
  href,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
  href?: string;
}) {
  const content = (
    <div className="flex h-full items-center justify-between">
      <div className="flex flex-col justify-center px-6 py-4">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground tracking-tight">{value}</span>
          {subtitle && <span className="text-xs text-muted-foreground font-medium">{subtitle}</span>}
        </div>
      </div>
      <div className="pr-6">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-lg ${color
            .replace("text-", "bg-")
            .replace("500", "500/10")} ${color}`}
        >
          <Icon className="h-7 w-7" />
        </div>
      </div>
    </div>
  );

  const containerClasses = "relative block h-full overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-border hover:bg-card";

  if (href) {
    return (
      <Link href={href} className={`group ${containerClasses}`}>
        {content}
      </Link>
    );
  }

  return (
    <div className={containerClasses}>
      {content}
    </div>
  );
}

/* eslint-disable @next/next/no-img-element */
function JobRow({ job, type = "default" }: { job: Job; type?: "default" | "applied" }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3 transition-all hover:border-border hover:bg-card"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {job.company.logoUrl ? (
          <img
            src={job.company.logoUrl}
            alt={job.company.name}
            className="h-9 w-9 rounded-md bg-muted object-contain p-1"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
            {job.company.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground group-hover:text-emerald-400 transition-colors">
            {job.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{job.company.name}</span>
            {job.location && (
              <>
                <span>&bull;</span>
                <span>{job.location}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {job.matchScore !== null && <MatchBadge score={job.matchScore} size="sm" />}
        <span className="text-[10px] text-muted-foreground font-medium">
          {type === "applied" && job.appliedAt
            ? `Applied ${formatRelativeTime(new Date(job.appliedAt))}`
            : formatRelativeTime(new Date(job.discoveredAt))}
        </span>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: profile, isLoading: isProfileLoading } = useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  const { data: stats, isLoading: isStatsLoading } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const isInitialLoading = isProfileLoading || isStatsLoading;

  // Top 5 high-match jobs (75%+)
  const { data: highMatchData } = useQuery({
    queryKey: ["jobs", "high-match"],
    queryFn: async () => {
      const res = await fetch("/api/jobs?minScore=75&sortBy=matchScore&sortOrder=desc&limit=5");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  // Recently discovered jobs
  const { data: recentJobsData } = useQuery({
    queryKey: ["jobs", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/jobs?status=new&sortBy=discoveredAt&sortOrder=desc&limit=5");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  // Recently applied jobs
  const { data: appliedJobsData } = useQuery({
    queryKey: ["jobs", "applied-recent"],
    queryFn: async () => {
      const res = await fetch("/api/jobs?status=applied&sortBy=discoveredAt&sortOrder=desc&limit=5");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const userName = profile?.name?.split(" ")[0] || "there";
  const highMatchJobs: Job[] = highMatchData?.jobs || [];
  const recentJobs: Job[] = recentJobsData?.jobs || [];
  const appliedJobs: Job[] = appliedJobsData?.jobs || [];
  const lastScan = stats?.lastScan;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            Dashboard
          </h1>
          <p className="mt-1 text-muted-foreground">
            Welcome back, {userName}. Here&apos;s what&apos;s happening with your job search.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isInitialLoading ? (
          <>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-12" />
                </div>
                <Skeleton className="h-12 w-12 rounded-lg" />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-12" />
                </div>
                <Skeleton className="h-12 w-12 rounded-lg" />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-8 w-12" />
                </div>
                <Skeleton className="h-12 w-12 rounded-lg" />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-12" />
                </div>
                <Skeleton className="h-12 w-12 rounded-lg" />
              </div>
            </div>
          </>
        ) : (
          <>
            <StatCard
              title="New Jobs"
              value={stats?.newJobs ?? 0}
              icon={Briefcase}
              color="text-blue-500"
              subtitle="this week"
            />
            <StatCard
              title="High Match"
              value={stats?.highMatchJobs ?? 0}
              icon={Star}
              color="text-amber-500"
              subtitle="75%+ score"
            />
            <StatCard
              title="Applied"
              value={stats?.appliedJobs ?? 0}
              icon={Send}
              color="text-emerald-500"
            />
            <StatCard
              title="Companies"
              value={stats?.totalCompanies ?? 0}
              icon={Building2}
              color="text-purple-500"
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content Column (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Getting Started (Conditional) */}
          {!isInitialLoading && (!profile?.name || (stats?.totalCompanies ?? 0) === 0) && (
            <div className="mb-6 rounded-xl border border-border bg-gradient-to-br from-card to-muted/40 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-medium text-foreground mb-1">Getting Started</h2>
                  <p className="text-sm text-muted-foreground mb-4">Complete these steps to start finding your dream job.</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Link
                  href="/profile"
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted hover:border-border"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80 font-medium text-sm border border-border">1</div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Upload Resume</p>
                    <p className="text-xs text-muted-foreground">To match skills</p>
                  </div>
                </Link>

                <Link
                  href="/companies"
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted hover:border-border"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80 font-medium text-sm border border-border">2</div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Add Companies</p>
                    <p className="text-xs text-muted-foreground">To track jobs</p>
                  </div>
                </Link>

                <Link
                  href="/jobs"
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted hover:border-border"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/80 font-medium text-sm border border-border">3</div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Review Matches</p>
                    <p className="text-xs text-muted-foreground">And apply</p>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {/* High Match Jobs */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-amber-500/10">
                  <Zap className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <h2 className="text-base font-medium text-foreground">Top Matches</h2>
                  <p className="text-xs text-muted-foreground">Jobs with 75%+ match score</p>
                </div>
              </div>
              <Link href="/jobs?minScore=75&sortBy=matchScore&sortOrder=desc">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-8">
                  View All
                </Button>
              </Link>
            </div>

            <div className="space-y-2">
              {highMatchJobs.length > 0 ? (
                highMatchJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-border rounded-lg">
                  <Star className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No high-match jobs found yet</p>
                  <p className="text-xs text-muted-foreground">Try adding more companies or skills</p>
                </div>
              )}
            </div>
          </div>

          {/* New Jobs */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-blue-500/10">
                  <Clock className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-base font-medium text-foreground">Recently Found</h2>
                  <p className="text-xs text-muted-foreground">Latest jobs from your companies</p>
                </div>
              </div>
              <Link href="/jobs?status=new&sortBy=discoveredAt&sortOrder=desc">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-8">
                  View All
                </Button>
              </Link>
            </div>

            <div className="space-y-2">
              {recentJobs.length > 0 ? (
                recentJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-border rounded-lg">
                  <Briefcase className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No new jobs found recently</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Column (1/3 width) */}
        <div className="space-y-6">
          {/* Recent Activity / Last Scan */}
          {lastScan && (
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  Latest Scan
                </h2>
                <Link href={`/history/${lastScan.id}`}>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-8">
                    View Details <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>

              <div className="flex items-center justify-between bg-background/60 rounded-lg border border-border p-4">
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    lastScan.status === "completed" ? "bg-emerald-500/10" : lastScan.status === "failed" ? "bg-red-500/10" : "bg-blue-500/10"
                  }`}>
                    {lastScan.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : lastScan.status === "failed" ? (
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {lastScan.status === "completed" ? "Completed" : lastScan.status === "in_progress" ? "Scanning..." : "Failed"}
                      </span>
                      <span className="text-xs text-muted-foreground">&bull;</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(new Date(lastScan.startedAt))}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{lastScan.companiesCompleted}/{lastScan.companiesTotal} Companies</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-lg font-semibold text-emerald-400">+{lastScan.totalJobsAdded}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">New</p>
                </div>
              </div>
            </div>
          )}

          {/* Recently Applied */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-emerald-500" />
                <h2 className="text-base font-medium text-foreground">Recent Applications</h2>
              </div>
              <Link href="/jobs?tab=applied">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground h-8 w-8 p-0">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <div className="space-y-3">
              {appliedJobs.length > 0 ? (
                appliedJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="block group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground/80 group-hover:text-emerald-400 truncate transition-colors">
                          {job.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{job.company.name}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
                        {job.appliedAt ? formatRelativeTime(new Date(job.appliedAt)) : ''}
                      </span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground">No applications yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Insights */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              <h2 className="text-base font-medium text-foreground">Insights</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
                <span className="text-sm text-muted-foreground">Saved Jobs</span>
                <div className="flex items-center gap-2">
                  <Star className="h-3.5 w-3.5 text-purple-500" />
                  <span className="text-sm font-medium text-foreground">{stats?.savedJobs || "-"}</span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
                <span className="text-sm text-muted-foreground">Viewed Jobs</span>
                <div className="flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{stats?.viewedJobs || "-"}</span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
                <span className="text-sm text-muted-foreground">Scored Jobs</span>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{stats?.jobsWithScore || "-"}</span>
                </div>
              </div>

              {stats?.totalJobs && stats.totalJobs > 0 && stats.highMatchJobs > 0 ? (
                <div className="mt-4 p-3 rounded-lg bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20">
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    <span className="font-semibold text-amber-400 text-sm">
                      {Math.round((stats.highMatchJobs / stats.totalJobs) * 100)}%
                    </span>{" "}
                    of your tracked jobs are a high match for your profile.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
