import type {
  Platform,
  TriggerSource,
  ScrapeLogStatus,
  MatcherStatus,
  SessionStatus,
  DescriptionFormat,
  EmploymentType,
  LocationType,
} from "@/lib/scraper/types";
import type { Company, NewJob } from "@/lib/db/schema";
import type { ScrapedJob } from "@/lib/scraper/types";

export interface ExistingJob {
  id: number;
  externalId: string | null;
  title: string;
  url: string;
  status: string;
  description: string | null;
}

export interface ExistingJobUpdate {
  existingJobId: number;
  title: string;
  url: string;
  location?: string;
  locationType?: LocationType;
  department?: string;
  description?: string;
  descriptionFormat: DescriptionFormat;
  salary?: string;
  employmentType?: EmploymentType;
  postedDate?: Date;
}

export interface SessionProgressUpdate {
  companiesCompleted: number;
  totalJobsFound: number;
  totalJobsAdded: number;
  totalJobsFiltered: number;
  totalJobsArchived: number;
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
  platform?: Platform | null;
  status: ScrapeLogStatus;
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsFiltered: number;
  jobsArchived: number;
  errorMessage?: string;
  duration: number;
  completedAt: Date;
  matcherStatus?: Extract<MatcherStatus, "pending"> | null;
  matcherJobsTotal?: number | null;
  matcherJobsCompleted?: number;
}

export interface ScrapingLogUpdate {
  matcherStatus?: MatcherStatus | null;
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
  reopenScraperArchivedJobs(companyId: number, openExternalIds: string[]): Promise<number>;
  archiveMissingJobs(
    companyId: number,
    openExternalIds: string[],
    statusesToArchive: string[]
  ): Promise<number>;
  
  insertJobs(jobs: Omit<NewJob, "discoveredAt" | "updatedAt">[]): Promise<number[]>;
  updateExistingJobsFromScrape(
    updates: Array<{ existingJobId: number; job: ScrapedJob }>
  ): Promise<number>;
  getMatchableJobIds(jobIds: number[]): Promise<number[]>;
  updateCompany(id: number, updates: CompanyUpdate): Promise<void>;
  
  createSession(session: ScrapeSessionCreate): Promise<void>;
  isSessionInProgress(id: string): Promise<boolean>;
  stopSession(id: string): Promise<boolean>;
  updateSessionProgress(id: string, progress: SessionProgressUpdate): Promise<void>;
  completeSession(
    id: string,
    status: Exclude<SessionStatus, "in_progress">
  ): Promise<void>;
  
  createScrapingLog(log: ScrapingLogCreate): Promise<number>;
  updateScrapingLog(id: number, updates: ScrapingLogUpdate): Promise<void>;
  
  acquireSchedulerLock(ownerId: string): Promise<string | null>;
  refreshSchedulerLock(lockToken: string): Promise<string | null>;
  releaseSchedulerLock(lockToken: string): Promise<void>;
}
