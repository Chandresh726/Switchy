export type Tab = "jobs" | "connections" | "activity";

export interface CompanyOverview {
  id: number;
  name: string;
  careersUrl: string;
  logoUrl: string | null;
  platform: string | null;
  isActive: boolean;
  lastScrapedAt: string | null;
}

export interface CompanyStats {
  openJobs: number;
  highMatchJobs: number;
  mappedConnections: number;
  starredConnections: number;
}

export interface CompanyJob {
  id: number;
  title: string;
  url: string;
  status: string;
  matchScore: number | null;
  location: string | null;
  locationType: string | null;
  discoveredAt: string | null;
}

export interface CompanyConnection {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  profileUrl: string;
  email: string | null;
  position: string | null;
  connectedOn: string | null;
  isStarred: boolean;
  notes: string | null;
}

export interface ScrapeLog {
  id: number;
  status: string;
  triggerSource: string | null;
  jobsFound: number | null;
  jobsAdded: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MatchSession {
  id: string;
  status: string;
  triggerSource: string;
  jobsTotal: number | null;
  jobsCompleted: number | null;
  jobsSucceeded: number | null;
  jobsFailed: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CompanyActivity {
  scrapeLogs: ScrapeLog[];
  matchSessions: MatchSession[];
}

export interface CompanyOverviewResponse {
  company: CompanyOverview;
  stats: CompanyStats;
  jobs: CompanyJob[];
  connections: CompanyConnection[];
  activity: CompanyActivity;
}

export interface ActivityItem {
  id: string;
  type: "scrape" | "match";
  status: string;
  triggerSource: string | null;
  startedAt: string | null;
  completedAt: string | null;
  summary: string;
}
