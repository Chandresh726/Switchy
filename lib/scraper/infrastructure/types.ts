import type { TriggerSource } from "@/lib/scraper/types";
import type { Company, NewJob } from "@/lib/db/schema";

export interface ExistingJob {
  id: number;
  externalId: string | null;
  title: string;
  url: string;
}

export interface SessionProgressUpdate {
  companiesCompleted: number;
  totalJobsFound: number;
  totalJobsAdded: number;
  totalJobsFiltered: number;
}

export interface ScrapeSessionCreate {
  id: string;
  triggerSource: TriggerSource;
  status: "in_progress";
  companiesTotal: number;
}

export interface ScrapingLogCreate {
  companyId: number;
  sessionId: string;
  triggerSource?: TriggerSource;
  platform?: string | null;
  status: "success" | "error" | "partial";
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsFiltered: number;
  errorMessage?: string;
  duration: number;
  completedAt: Date;
  matcherStatus?: "pending" | null;
  matcherJobsTotal?: number | null;
  matcherJobsCompleted?: number;
}

export interface ScrapingLogUpdate {
  matcherStatus?: "pending" | "in_progress" | "completed" | "failed" | null;
  matcherJobsCompleted?: number;
  matcherJobsTotal?: number | null;
  matcherErrorCount?: number;
  matcherDuration?: number;
}

export interface CompanyUpdate {
  lastScrapedAt: Date;
  updatedAt: Date;
  boardToken?: string;
}

export interface IScraperRepository {
  getCompany(id: number): Promise<Company | null>;
  getActiveCompanies(): Promise<Company[]>;
  getExistingJobs(companyId: number): Promise<ExistingJob[]>;
  getSetting(key: string): Promise<string | null>;
  
  insertJobs(jobs: Omit<NewJob, "discoveredAt" | "updatedAt">[]): Promise<number[]>;
  updateCompany(id: number, updates: CompanyUpdate): Promise<void>;
  
  createSession(session: ScrapeSessionCreate): Promise<void>;
  updateSessionProgress(id: string, progress: SessionProgressUpdate): Promise<void>;
  completeSession(id: string, hasFailures: boolean): Promise<void>;
  
  createScrapingLog(log: ScrapingLogCreate): Promise<number>;
  updateScrapingLog(id: number, updates: ScrapingLogUpdate): Promise<void>;
  
  acquireSchedulerLock(): Promise<boolean>;
  releaseSchedulerLock(): Promise<void>;
}
