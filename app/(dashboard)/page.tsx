"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Star,
  TrendingUp,
  Clock,
  MapPin,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  Zap,
  ArrowRight,
  Send,
} from "lucide-react";
import Link from "next/link";
import { MatchBadge } from "@/components/jobs/match-badge";

interface ScrapeSession {
  id: string;
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
  return date.toLocaleDateString();
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
    <div className="flex items-center gap-3 h-full">
      <div className={`rounded-lg p-2.5 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex flex-col justify-center">
        <p className="text-2xl font-semibold text-white">{value}</p>
        <p className="text-xs text-zinc-400">{title}</p>
        <p className="text-xs text-zinc-500 min-h-[16px]">{subtitle || "\u00A0"}</p>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      {content}
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group flex items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium text-white group-hover:text-emerald-400">
            {job.title}
          </h3>
          {job.matchScore !== null && <MatchBadge score={job.matchScore} size="sm" />}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            {job.company.name}
          </span>
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {job.location}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs text-zinc-500">{formatRelativeTime(new Date(job.discoveredAt))}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: profile } = useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  // Top 5 high-match jobs (80%+)
  const { data: highMatchData } = useQuery({
    queryKey: ["jobs", "high-match"],
    queryFn: async () => {
      const res = await fetch("/api/jobs?minScore=80&sortBy=matchScore&sortOrder=desc&limit=5");
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-white">
          Welcome back, {userName}!
        </h1>
        <p className="mt-1 text-zinc-400">
          Here&apos;s an overview of your job search
        </p>
      </div>

      {/* Stats Row with Last Scan */}
      <div className="flex gap-4 h-[100px]">
        {/* Stats Grid - 70% */}
        <div className="grid flex-[7] gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="New Jobs"
            value={stats?.newJobs ?? 0}
            icon={Briefcase}
            color="bg-blue-500/10 text-blue-500"
            href="/jobs?status=new"
          />
          <StatCard
            title="High Match"
            value={stats?.highMatchJobs ?? 0}
            icon={Star}
            color="bg-amber-500/10 text-amber-500"
            subtitle="80%+ score"
            href="/jobs?minScore=80"
          />
          <StatCard
            title="Applied"
            value={stats?.appliedJobs ?? 0}
            icon={Send}
            color="bg-emerald-500/10 text-emerald-500"
            href="/jobs?status=applied"
          />
          <StatCard
            title="Companies"
            value={stats?.totalCompanies ?? 0}
            icon={Building2}
            color="bg-purple-500/10 text-purple-500"
            href="/companies"
          />
        </div>

        {/* Last Scan Status - 30% */}
        <div className="flex-[3] rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Last Scan</span>
          </div>

          {lastScan ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {lastScan.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : lastScan.status === "in_progress" ? (
                  <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                )}
                <span className="text-xl font-semibold text-white">
                  {formatRelativeTime(new Date(lastScan.startedAt))}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-lg font-semibold text-white">{lastScan.totalJobsAdded}</p>
                  <p className="text-xs text-zinc-500">Jobs</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-white">{lastScan.companiesCompleted}/{lastScan.companiesTotal}</p>
                  <p className="text-xs text-zinc-500">Companies</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded ${
                  lastScan.status === "completed"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : lastScan.status === "in_progress"
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-red-500/10 text-red-400"
                }`}>
                  {lastScan.status === "completed" ? "Completed" : lastScan.status === "in_progress" ? "Running" : "Failed"}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">No scans yet</span>
              <span className="text-xs text-zinc-500">Go to Settings to scan</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* High Match Jobs */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex flex-col min-h-[380px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              <h2 className="text-base font-medium text-white">Top Matches</h2>
            </div>
            <span className="text-xs text-zinc-500">80%+ match score</span>
          </div>

          <div className="flex-1 space-y-2">
            {highMatchJobs.length > 0 ? (
              highMatchJobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-center">
                <Star className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-400">
                  No high-match jobs yet
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Jobs with 80%+ match will appear here
                </p>
              </div>
            )}
          </div>

          <Link
            href="/jobs?minScore=80&sortBy=matchScore"
            className="mt-auto pt-4 flex items-center justify-center gap-1 rounded-lg py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
          >
            View all high matches
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Recently Discovered Jobs */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex flex-col min-h-[380px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <h2 className="text-base font-medium text-white">New Jobs</h2>
            </div>
            <span className="text-xs text-zinc-500">Recently discovered</span>
          </div>

          <div className="flex-1 space-y-2">
            {recentJobs.length > 0 ? (
              recentJobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-center">
                <Briefcase className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-400">
                  No new jobs yet
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Add companies to start tracking jobs
                </p>
              </div>
            )}
          </div>

          <Link
            href="/jobs?status=new&sortBy=discoveredAt"
            className="mt-auto pt-4 flex items-center justify-center gap-1 rounded-lg py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
          >
            View all new jobs
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Applied Jobs */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex flex-col min-h-[380px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-emerald-500" />
              <h2 className="text-base font-medium text-white">Recently Applied</h2>
            </div>
            <span className="text-xs text-zinc-500">Your applications</span>
          </div>

          <div className="flex-1 space-y-2">
            {appliedJobs.length > 0 ? (
              appliedJobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-center">
                <Send className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="mt-2 text-sm text-zinc-400">
                  No applications yet
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Mark jobs as &quot;Applied&quot; to track them here
                </p>
              </div>
            )}
          </div>

          <Link
            href="/jobs?status=applied"
            className="mt-auto pt-4 flex items-center justify-center gap-1 rounded-lg py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
          >
            View all applications
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Quick Stats / Insights */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-500" />
            <h2 className="text-base font-medium text-white">Quick Insights</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-zinc-800/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Briefcase className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-white">Total Jobs Tracked</p>
                  <p className="text-xs text-zinc-500">Across all companies</p>
                </div>
              </div>
              <span className="text-xl font-semibold text-white">{stats?.totalJobs ?? 0}</span>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-zinc-800/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm text-white">Jobs with Match Score</p>
                  <p className="text-xs text-zinc-500">AI-analyzed jobs</p>
                </div>
              </div>
              <span className="text-xl font-semibold text-white">{stats?.jobsWithScore ?? 0}</span>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-zinc-800/30 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-500/10 p-2">
                  <Eye className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-white">Viewed Jobs</p>
                  <p className="text-xs text-zinc-500">Jobs you&apos;ve looked at</p>
                </div>
              </div>
              <span className="text-xl font-semibold text-white">{stats?.viewedJobs ?? 0}</span>
            </div>

            {stats?.totalJobs && stats.totalJobs > 0 && stats.highMatchJobs > 0 && (
              <div className="rounded-lg bg-gradient-to-r from-amber-500/10 to-emerald-500/10 px-4 py-3">
                <p className="text-sm text-zinc-300">
                  <span className="font-semibold text-emerald-400">
                    {Math.round((stats.highMatchJobs / stats.totalJobs) * 100)}%
                  </span>{" "}
                  of jobs are high matches for your profile
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Getting Started Guide (for new users) */}
      {(!profile?.name || (stats?.totalCompanies ?? 0) === 0) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 text-lg font-medium text-white">Getting Started</h2>
          <div className="space-y-4 text-zinc-400">
            <p>Welcome to Switchy! Here&apos;s how to get started:</p>
            <ol className="list-inside list-decimal space-y-2">
              <li>
                <strong className="text-zinc-200">Set up your profile</strong> -
                Upload your resume to auto-fill your skills and experience
              </li>
              <li>
                <strong className="text-zinc-200">Add companies</strong> - Track
                companies you&apos;re interested in by adding their careers page
              </li>
              <li>
                <strong className="text-zinc-200">Browse jobs</strong> - We&apos;ll
                automatically fetch job postings and match them to your profile
              </li>
              <li>
                <strong className="text-zinc-200">Apply with confidence</strong> -
                Use AI-powered match scores to prioritize your applications
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
