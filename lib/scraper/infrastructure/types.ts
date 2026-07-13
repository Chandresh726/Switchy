import type { Company, NewJob } from "@/lib/db/schema";
import type {
  Platform,
  TriggerSource,
  ScrapeLogStatus,
  MatcherStatus,
  SessionStatus,
  ScrapedJob,
} from "@/lib/scraper/types";

export interface ExistingJob {
  id: number;
  externalId: string | null;
  title: string;
  url: string;
  location?: string | null;
  status: string;
  description: string | null;
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
  status: "in_progress" | "skipped";
  companiesTotal: number;
  companiesCompleted?: number;
  totalJobsFound?: number;
  totalJobsAdded?: number;
  totalJobsFiltered?: number;
  totalJobsArchived?: number;
  skipReason?: string;
  scheduledForAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
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

export type ScrapeResultLogCreate = Omit<
  ScrapingLogCreate,
  | "companyId"
  | "jobsAdded"
  | "jobsUpdated"
  | "jobsArchived"
  | "duration"
  | "completedAt"
  | "matcherStatus"
  | "matcherJobsTotal"
  | "matcherJobsCompleted"
>;

export interface PersistScrapeResultInput {
  companyId: number;
  openExternalIds: string[];
  archiveMissing: boolean;
  statusesToArchive: string[];
  jobsToInsert: Omit<
    NewJob,
    "id" | "companyId" | "discoveredAt" | "updatedAt"
  >[];
  existingJobUpdates: Array<{ existingJobId: number; job: ScrapedJob }>;
  companyBoardToken?: string;
  startedAtMs: number;
  enableMatching: boolean;
  log: ScrapeResultLogCreate;
}

export interface PersistScrapeResultOutput {
  insertedJobIds: number[];
  matchableJobIds: number[];
  jobsAdded: number;
  jobsUpdated: number;
  jobsArchived: number;
  logId: number;
  matchOutboxId: string | null;
}

export interface CompanyCatalog {
  getCompany(id: number): Promise<Company | null>;
  getActiveCompanies(): Promise<Company[]>;
  getExistingJobs(companyId: number): Promise<ExistingJob[]>;
}

export interface ScrapeSettingsSource {
  getSetting(key: string): Promise<string | null>;
}

export interface ScrapeResultUnitOfWork {
  persistScrapeResult(input: PersistScrapeResultInput): Promise<PersistScrapeResultOutput>;
  createScrapingLog(log: ScrapingLogCreate): Promise<number>;
}

export interface ScrapeSessionStore {
  createSession(session: ScrapeSessionCreate): Promise<void>;
  isSessionInProgress(id: string): Promise<boolean>;
  stopSession(id: string): Promise<boolean>;
  updateSessionProgress(id: string, progress: SessionProgressUpdate): Promise<void>;
  completeSession(
    id: string,
    status: Exclude<SessionStatus, "in_progress">
  ): Promise<void>;
}

export type ScrapePipelineStore = CompanyCatalog &
  ScrapeResultUnitOfWork &
  ScrapeSessionStore &
  ScrapeSettingsSource;

export type IScraperRepository = ScrapePipelineStore;
