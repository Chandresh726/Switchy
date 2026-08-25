import {
  sqliteTable,
  text,
  integer,
  real,
  unique,
  uniqueIndex,
  index,
  check,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

import type { JobStatus } from "@/lib/jobs/status";

// Profile - Single user profile
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  singletonKey: text("singleton_key").notNull().default("local"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  preferredCountry: text("preferred_country"),
  preferredCity: text("preferred_city"),
  linkedinUrl: text("linkedin_url"),
  githubUrl: text("github_url"),
  portfolioUrl: text("portfolio_url"),
  resumePath: text("resume_path"),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  singletonKeyUnique: uniqueIndex("profile_singleton_key_unique").on(table.singletonKey),
  singletonKeyCheck: check("profile_singleton_key_check", sql`${table.singletonKey} = 'local'`),
}));

// Resumes - Uploaded resumes and their parsed data
export const resumes = sqliteTable("resumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  parsedData: text("parsed_data").notNull(), // JSON string
  aiRunId: text("ai_run_id").references(() => aiRuns.id),
  parserVersion: text("parser_version"),
  validationWarnings: text("validation_warnings"), // JSON array validated by resume repository
  version: integer("version").notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
  storageState: text("storage_state").notNull().default("ready"),
  stagingPath: text("staging_path"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  profileVersionUnique: uniqueIndex("resumes_profile_version_unique").on(table.profileId, table.version),
  oneCurrentPerProfile: uniqueIndex("resumes_one_current_per_profile_unique")
    .on(table.profileId)
    .where(sql`${table.isCurrent} = 1`),
  storageStateCheck: check("resumes_storage_state_check", sql`${table.storageState} in ('staging', 'ready', 'deleting', 'missing')`),
}));

// Skills - User skills
export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  category: text("category"), // e.g., "frontend", "backend", "devops", "soft skills"
}, (table) => ({ profileIdIdx: index("skills_profile_id_idx").on(table.profileId) }));

// Experience - Work history
export const experience = sqliteTable("experience", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }).notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"), // null = current
  description: text("description"),
  highlights: text("highlights"), // JSON array stored as text
}, (table) => ({ profileIdIdx: index("experience_profile_id_idx").on(table.profileId) }));

// Education - Education history
export const education = sqliteTable("education", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }).notNull(),
  institution: text("institution").notNull(),
  degree: text("degree").notNull(),
  field: text("field"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  gpa: text("gpa"),
  honors: text("honors"),
}, (table) => ({ profileIdIdx: index("education_profile_id_idx").on(table.profileId) }));

// Companies - Tracked companies with careers page URLs
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  careersUrl: text("careers_url").notNull(),
  logoUrl: text("logo_url"),
  notes: text("notes"),
  platform: text("platform"), // "greenhouse", "lever", "custom"
  boardToken: text("board_token"), // Manual board token for platforms like Greenhouse (when URL doesn't contain it)
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastScrapedAt: integer("last_scraped_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  careersUrlUnique: uniqueIndex("companies_careers_url_unique").on(table.careersUrl),
}));

// Jobs - Job postings with match scores
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  externalId: text("external_id"), // for deduplication
  title: text("title").notNull(),
  description: text("description"), // Job description (markdown or plain text)
  descriptionFormat: text("description_format").notNull().default("plain"), // "markdown", "plain", "html"
  url: text("url").notNull(),
  location: text("location"),
  locationType: text("location_type"), // "remote", "hybrid", "onsite"
  salary: text("salary"),
  department: text("department"),
  employmentType: text("employment_type"), // "full-time", "part-time", "contract"
  seniorityLevel: text("seniority_level"), // "entry", "mid", "senior", "lead", "manager"
  aiFingerprint: text("ai_fingerprint"), // Derived from AI-relevant job content; maintained without touching updatedAt
  status: text("status").$type<JobStatus>().notNull().default("new"),
  matchScore: real("match_score"), // 0-100
  matchReasons: text("match_reasons"), // JSON array
  matchedSkills: text("matched_skills"), // JSON array
  missingSkills: text("missing_skills"), // JSON array
  recommendations: text("recommendations"), // JSON array
  postedDate: integer("posted_date", { mode: "timestamp" }),
  discoveredAt: integer("discovered_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  archiveSource: text("archive_source"), // "manual" | "scraper"
  viewedAt: integer("viewed_at", { mode: "timestamp" }),
  appliedAt: integer("applied_at", { mode: "timestamp" }),
}, (table) => ({
  companyIdIdx: index("jobs_company_id_idx").on(table.companyId),
  statusIdx: index("jobs_status_idx").on(table.status),
  statusDiscoveredIdIdx: index("jobs_status_discovered_id_idx").on(table.status, table.discoveredAt, table.id),
  companyDiscoveredIdIdx: index("jobs_company_discovered_id_idx").on(table.companyId, table.discoveredAt, table.id),
  discoveredIdIdx: index("jobs_discovered_id_idx").on(table.discoveredAt, table.id),
  matchScoreIdx: index("jobs_match_score_idx").on(table.matchScore),
  aiFingerprintIdx: index("jobs_ai_fingerprint_idx").on(table.aiFingerprint),
  companyExternalIdUnique: unique("jobs_company_external_id_unique").on(table.companyId, table.externalId),
  companyUrlUnique: unique("jobs_company_url_unique").on(table.companyId, table.url),
  statusCheck: check("jobs_status_check", sql`${table.status} in ('new', 'viewed', 'interested', 'applied', 'rejected', 'archived')`),
  matchScoreCheck: check("jobs_match_score_check", sql`${table.matchScore} is null or (${table.matchScore} >= 0 and ${table.matchScore} <= 100)`),
}));

// Scrape Sessions - Track batch scrape operations
export const scrapeSessions = sqliteTable("scrape_sessions", {
  id: text("id").primaryKey(), // UUID
  triggerSource: text("trigger_source").notNull(), // "manual" | "scheduler" | "scheduler_recovery" | "company_refresh"
  status: text("status").notNull().default("in_progress"), // "in_progress" | "completed" | "partial" | "failed" | "skipped"
  companiesTotal: integer("companies_total").default(0),
  companiesCompleted: integer("companies_completed").default(0),
  totalJobsFound: integer("total_jobs_found").default(0),
  totalJobsAdded: integer("total_jobs_added").default(0),
  totalJobsFiltered: integer("total_jobs_filtered").default(0),
  totalJobsArchived: integer("total_jobs_archived").default(0),
  skipReason: text("skip_reason"),
  scheduledForAt: integer("scheduled_for_at", { mode: "timestamp" }),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
}, (table) => ({
  startedIdIdx: index("scrape_sessions_started_id_idx").on(table.startedAt, table.id),
  companiesTotalCheck: check("scrape_sessions_companies_total_check", sql`${table.companiesTotal} is null or ${table.companiesTotal} >= 0`),
  companiesCompletedCheck: check("scrape_sessions_companies_completed_check", sql`${table.companiesCompleted} is null or ${table.companiesCompleted} >= 0`),
  totalJobsFoundCheck: check("scrape_sessions_jobs_found_check", sql`${table.totalJobsFound} is null or ${table.totalJobsFound} >= 0`),
  totalJobsAddedCheck: check("scrape_sessions_jobs_added_check", sql`${table.totalJobsAdded} is null or ${table.totalJobsAdded} >= 0`),
  totalJobsFilteredCheck: check("scrape_sessions_jobs_filtered_check", sql`${table.totalJobsFiltered} is null or ${table.totalJobsFiltered} >= 0`),
  totalJobsArchivedCheck: check("scrape_sessions_jobs_archived_check", sql`${table.totalJobsArchived} is null or ${table.totalJobsArchived} >= 0`),
}));

// Scrape Queue Items - Durable local work with leases for crash recovery
export const scrapeQueueItems = sqliteTable("scrape_queue_items", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => scrapeSessions.id, { onDelete: "cascade" })
    .notNull(),
  companyId: integer("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull().default("queued"), // "queued" | "running" | "completed" | "failed" | "cancelled"
  priority: integer("priority").notNull().default(100),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: integer("available_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  workerId: text("worker_id"),
  lockedAt: integer("locked_at", { mode: "timestamp" }),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  lastError: text("last_error"),
  resultJson: text("result_json"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  sessionCompanyUnique: unique("scrape_queue_session_company_unique").on(
    table.sessionId,
    table.companyId
  ),
  claimIdx: index("scrape_queue_claim_idx").on(
    table.status,
    table.availableAt,
    table.priority,
    table.createdAt
  ),
  sessionStatusIdx: index("scrape_queue_session_status_idx").on(
    table.sessionId,
    table.status
  ),
  sessionCreatedIdIdx: index("scrape_queue_session_created_id_idx").on(
    table.sessionId,
    table.createdAt,
    table.id
  ),
  leaseIdx: index("scrape_queue_lease_idx").on(table.status, table.leaseExpiresAt),
  attemptCountCheck: check("scrape_queue_attempt_count_check", sql`${table.attemptCount} >= 0`),
  maxAttemptsCheck: check("scrape_queue_max_attempts_check", sql`${table.maxAttempts} > 0`),
}));

// Scraping Logs - Audit trail for scraping operations
export const scrapingLogs = sqliteTable("scraping_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => scrapeSessions.id, { onDelete: "cascade" }),
  triggerSource: text("trigger_source"), // "manual" | "auto_match" | "company_refresh" | "match_unmatched"
  status: text("status").notNull(), // "success", "error", "partial"
  jobsFound: integer("jobs_found").default(0),
  jobsAdded: integer("jobs_added").default(0),
  jobsUpdated: integer("jobs_updated").default(0),
  jobsFiltered: integer("jobs_filtered").default(0), // Jobs filtered by location preference
  jobsArchived: integer("jobs_archived").default(0),
  platform: text("platform"), // "greenhouse" | "lever" etc.
  errorMessage: text("error_message"),
  duration: integer("duration"), // milliseconds
  fetchDuration: integer("fetch_duration"),
  processingDuration: integer("processing_duration"),
  persistenceDuration: integer("persistence_duration"),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  // Matcher tracking
  matcherStatus: text("matcher_status"), // "pending" | "in_progress" | "completed" | "failed"
  matcherJobsTotal: integer("matcher_jobs_total"),
  matcherJobsCompleted: integer("matcher_jobs_completed"),
  matcherDuration: integer("matcher_duration"),
  matcherErrorCount: integer("matcher_error_count").default(0),
}, (table) => ({
  sessionIdIdx: index("scraping_logs_session_id_idx").on(table.sessionId),
  companyIdIdx: index("scraping_logs_company_id_idx").on(table.companyId),
  sessionStartedIdIdx: index("scraping_logs_session_started_id_idx").on(table.sessionId, table.startedAt, table.id),
  companyStartedIdIdx: index("scraping_logs_company_started_id_idx").on(table.companyId, table.startedAt, table.id),
  jobsFoundCheck: check("scraping_logs_jobs_found_check", sql`${table.jobsFound} is null or ${table.jobsFound} >= 0`),
  jobsAddedCheck: check("scraping_logs_jobs_added_check", sql`${table.jobsAdded} is null or ${table.jobsAdded} >= 0`),
  jobsUpdatedCheck: check("scraping_logs_jobs_updated_check", sql`${table.jobsUpdated} is null or ${table.jobsUpdated} >= 0`),
  jobsFilteredCheck: check("scraping_logs_jobs_filtered_check", sql`${table.jobsFiltered} is null or ${table.jobsFiltered} >= 0`),
  jobsArchivedCheck: check("scraping_logs_jobs_archived_check", sql`${table.jobsArchived} is null or ${table.jobsArchived} >= 0`),
  durationCheck: check("scraping_logs_duration_check", sql`${table.duration} is null or ${table.duration} >= 0`),
  matcherJobsTotalCheck: check("scraping_logs_matcher_jobs_total_check", sql`${table.matcherJobsTotal} is null or ${table.matcherJobsTotal} >= 0`),
  matcherJobsCompletedCheck: check("scraping_logs_matcher_jobs_completed_check", sql`${table.matcherJobsCompleted} is null or ${table.matcherJobsCompleted} >= 0`),
  matcherDurationCheck: check("scraping_logs_matcher_duration_check", sql`${table.matcherDuration} is null or ${table.matcherDuration} >= 0`),
  matcherErrorCountCheck: check("scraping_logs_matcher_error_count_check", sql`${table.matcherErrorCount} is null or ${table.matcherErrorCount} >= 0`),
}));

// Scrape Match Outbox - Durable handoff from committed jobs to background AI matching
export const scrapeMatchOutbox = sqliteTable("scrape_match_outbox", {
  id: text("id")
    .primaryKey()
    .references(() => matchSessions.id, { onDelete: "cascade" }),
  scrapingLogId: integer("scraping_log_id")
    .references(() => scrapingLogs.id, { onDelete: "restrict" })
    .notNull(),
  companyId: integer("company_id")
    .references(() => companies.id, { onDelete: "restrict" })
    .notNull(),
  jobIdsJson: text("job_ids_json").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed"
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: integer("available_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  workerId: text("worker_id"),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
}, (table) => ({
  scrapingLogUnique: unique("scrape_match_outbox_log_unique").on(table.scrapingLogId),
  pendingIdx: index("scrape_match_outbox_pending_idx").on(
    table.status,
    table.availableAt,
    table.createdAt
  ),
  leaseIdx: index("scrape_match_outbox_lease_idx").on(table.status, table.leaseExpiresAt),
  attemptCountCheck: check("scrape_match_outbox_attempt_count_check", sql`${table.attemptCount} >= 0`),
  maxAttemptsCheck: check("scrape_match_outbox_max_attempts_check", sql`${table.maxAttempts} > 0`),
}));

// Generic durable local AI work. Payload/result JSON is validated by the work repository.
export const aiWorkItems = sqliteTable("ai_work_items", {
  id: text("id").primaryKey(),
  workType: text("work_type").notNull(),
  matchSessionId: text("match_session_id")
    .references(() => matchSessions.id, { onDelete: "cascade" }),
  scrapingLogId: integer("scraping_log_id")
    .references(() => scrapingLogs.id, { onDelete: "restrict" }),
  companyId: integer("company_id")
    .references(() => companies.id, { onDelete: "restrict" }),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(100),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: integer("available_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  workerId: text("worker_id"),
  lockedAt: integer("locked_at", { mode: "timestamp" }),
  leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  resultJson: text("result_json"),
  lastErrorCode: text("last_error_code"),
  lastError: text("last_error"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  sessionWorkUnique: unique("ai_work_items_session_work_unique").on(
    table.matchSessionId,
    table.workType
  ),
  claimIdx: index("ai_work_items_claim_idx").on(
    table.workType,
    table.status,
    table.availableAt,
    table.priority,
    table.createdAt
  ),
  sessionStatusIdx: index("ai_work_items_session_status_idx").on(
    table.matchSessionId,
    table.status
  ),
  scrapingLogIdx: index("ai_work_items_scraping_log_idx").on(table.scrapingLogId),
  companyStatusIdx: index("ai_work_items_company_status_idx").on(table.companyId, table.status),
  leaseIdx: index("ai_work_items_lease_idx").on(table.status, table.leaseExpiresAt),
}));

// Match Sessions - Track batch match operations
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// AI Providers - User-configured AI provider instances
export const aiProviders = sqliteTable("aiProviders", {
  id: text("id").primaryKey(), // UUID
  provider: text("provider").notNull(), // "anthropic", "openai", "gemini_api_key", "openrouter", "cerebras", "groq", "nvidia"
  apiKey: text("api_key"), // Encrypted API key
  displayName: text("display_name"),
  apiFormat: text("api_format"),
  baseUrl: text("base_url"),
  encryptedHeaders: text("encrypted_headers"),
  manualModelIds: text("manual_model_ids"),
  reasoningEfforts: text("reasoning_efforts"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  isDefault: integer("is_default", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  builtInProviderUnique: uniqueIndex("ai_providers_builtin_provider_unique")
    .on(table.provider)
    .where(sql`${table.provider} <> 'custom'`),
}));

// AI Runs - Sanitized provenance and telemetry for every logical AI execution
export const aiRuns = sqliteTable("ai_runs", {
  id: text("id").primaryKey(),
  capability: text("capability").notNull(),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  providerRecordId: text("provider_record_id").notNull(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  policyVersion: text("policy_version").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  status: text("status").notNull().default("running"),
  attemptCount: integer("attempt_count").notNull().default(0),
  inputTokens: integer("input_tokens"),
  inputNoCacheTokens: integer("input_no_cache_tokens"),
  inputCacheReadTokens: integer("input_cache_read_tokens"),
  inputCacheWriteTokens: integer("input_cache_write_tokens"),
  outputTokens: integer("output_tokens"),
  outputTextTokens: integer("output_text_tokens"),
  outputReasoningTokens: integer("output_reasoning_tokens"),
  totalTokens: integer("total_tokens"),
  durationMs: integer("duration_ms"),
  finishReason: text("finish_reason"),
  providerRequestId: text("provider_request_id"),
  providerConfigFingerprint: text("provider_config_fingerprint"),
  runtimeInstanceId: text("runtime_instance_id"),
  cacheStatus: text("cache_status").notNull().default("miss"),
  qualityResult: text("quality_result").notNull().default("not_checked"),
  warningsJson: text("warnings_json"),
  metadataJson: text("metadata_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  capabilityCreatedIdx: index("ai_runs_capability_created_idx").on(
    table.capability,
    table.createdAt
  ),
  subjectIdx: index("ai_runs_subject_idx").on(table.subjectType, table.subjectId),
  statusCreatedIdx: index("ai_runs_status_created_idx").on(table.status, table.createdAt),
  createdAtIdx: index("ai_runs_created_at_idx").on(table.createdAt),
  capabilityCheck: check(
    "ai_runs_capability_check",
    sql`${table.capability} in ('job_analysis', 'match_adjudication', 'match_evaluation', 'writing_cover_letter', 'writing_referral', 'writing_recruiter_follow_up', 'resume_parse')`
  ),
  statusCheck: check(
    "ai_runs_status_check",
    sql`${table.status} in ('running', 'succeeded', 'failed', 'cancelled', 'abandoned')`
  ),
  attemptCountCheck: check("ai_runs_attempt_count_check", sql`${table.attemptCount} >= 0`),
  tokenCountsCheck: check(
    "ai_runs_token_counts_check",
    sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0)
      and (${table.inputNoCacheTokens} is null or ${table.inputNoCacheTokens} >= 0)
      and (${table.inputCacheReadTokens} is null or ${table.inputCacheReadTokens} >= 0)
      and (${table.inputCacheWriteTokens} is null or ${table.inputCacheWriteTokens} >= 0)
      and (${table.outputTokens} is null or ${table.outputTokens} >= 0)
      and (${table.outputTextTokens} is null or ${table.outputTextTokens} >= 0)
      and (${table.outputReasoningTokens} is null or ${table.outputReasoningTokens} >= 0)
      and (${table.totalTokens} is null or ${table.totalTokens} >= 0)`
  ),
  durationCheck: check(
    "ai_runs_duration_check",
    sql`${table.durationMs} is null or ${table.durationMs} >= 0`
  ),
  subjectPairCheck: check(
    "ai_runs_subject_pair_check",
    sql`(${table.subjectType} is null) = (${table.subjectId} is null)`
  ),
  completionCheck: check(
    "ai_runs_completion_check",
    sql`(${table.status} = 'running' and ${table.completedAt} is null)
      or (${table.status} <> 'running' and ${table.completedAt} is not null)`
  ),
}));

export const aiRunAttempts = sqliteTable("ai_run_attempts", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => aiRuns.id, { onDelete: "cascade" }).notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull().default("running"),
  inputTokens: integer("input_tokens"),
  inputNoCacheTokens: integer("input_no_cache_tokens"),
  inputCacheReadTokens: integer("input_cache_read_tokens"),
  inputCacheWriteTokens: integer("input_cache_write_tokens"),
  outputTokens: integer("output_tokens"),
  outputTextTokens: integer("output_text_tokens"),
  outputReasoningTokens: integer("output_reasoning_tokens"),
  totalTokens: integer("total_tokens"),
  durationMs: integer("duration_ms"),
  finishReason: text("finish_reason"),
  providerRequestId: text("provider_request_id"),
  warningCodesJson: text("warning_codes_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  retryDelayMs: integer("retry_delay_ms"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
}, (table) => ({
  runAttemptUnique: unique("ai_run_attempts_run_attempt_unique").on(
    table.runId,
    table.attemptNumber
  ),
  runIdx: index("ai_run_attempts_run_idx").on(table.runId, table.attemptNumber),
  statusStartedIdx: index("ai_run_attempts_status_started_idx").on(
    table.status,
    table.startedAt
  ),
  attemptNumberCheck: check(
    "ai_run_attempts_number_check",
    sql`${table.attemptNumber} > 0`
  ),
  statusCheck: check(
    "ai_run_attempts_status_check",
    sql`${table.status} in ('running', 'succeeded', 'failed', 'cancelled', 'abandoned')`
  ),
  durationCheck: check(
    "ai_run_attempts_duration_check",
    sql`${table.durationMs} is null or ${table.durationMs} >= 0`
  ),
  retryDelayCheck: check(
    "ai_run_attempts_retry_delay_check",
    sql`${table.retryDelayMs} is null or ${table.retryDelayMs} >= 0`
  ),
  tokenCountsCheck: check(
    "ai_run_attempts_token_counts_check",
    sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0)
      and (${table.inputNoCacheTokens} is null or ${table.inputNoCacheTokens} >= 0)
      and (${table.inputCacheReadTokens} is null or ${table.inputCacheReadTokens} >= 0)
      and (${table.inputCacheWriteTokens} is null or ${table.inputCacheWriteTokens} >= 0)
      and (${table.outputTokens} is null or ${table.outputTokens} >= 0)
      and (${table.outputTextTokens} is null or ${table.outputTextTokens} >= 0)
      and (${table.outputReasoningTokens} is null or ${table.outputReasoningTokens} >= 0)
      and (${table.totalTokens} is null or ${table.totalTokens} >= 0)`
  ),
  completionCheck: check(
    "ai_run_attempts_completion_check",
    sql`(${table.status} = 'running' and ${table.completedAt} is null)
      or (${table.status} <> 'running' and ${table.completedAt} is not null)`
  ),
}));

export const aiCacheEvents = sqliteTable("ai_cache_events", {
  id: text("id").primaryKey(),
  capability: text("capability").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  sourceRunId: text("source_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  artifactType: text("artifact_type").notNull(),
  artifactId: text("artifact_id").notNull(),
  sessionId: text("session_id").references(() => matchSessions.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  capabilityCreatedIdx: index("ai_cache_events_capability_created_idx").on(
    table.capability,
    table.createdAt
  ),
  subjectCreatedIdx: index("ai_cache_events_subject_created_idx").on(
    table.subjectType,
    table.subjectId,
    table.createdAt
  ),
  sessionIdx: index("ai_cache_events_session_idx").on(table.sessionId),
  capabilityCheck: check(
    "ai_cache_events_capability_check",
    sql`${table.capability} in ('job_analysis', 'match_adjudication', 'match_evaluation', 'writing_cover_letter', 'writing_referral', 'writing_recruiter_follow_up', 'resume_parse')`
  ),
}));

// Immutable normalized candidate evidence used by versioned matching.
export const candidateSnapshots = sqliteTable("candidate_snapshots", {
  id: text("id").primaryKey(),
  sourceProfileId: integer("source_profile_id"),
  fingerprint: text("fingerprint").notNull(),
  snapshotVersion: text("snapshot_version").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  fingerprintVersionUnique: unique("candidate_snapshots_fingerprint_version_unique").on(
    table.fingerprint,
    table.snapshotVersion
  ),
  sourceProfileIdx: index("candidate_snapshots_source_profile_idx").on(
    table.sourceProfileId,
    table.createdAt
  ),
}));

// Immutable structured job evidence, reusable across matching runs.
export const jobAnalyses = sqliteTable("job_analyses", {
  id: text("id").primaryKey(),
  jobFingerprint: text("job_fingerprint").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  fingerprintExtractorUnique: unique("job_analyses_fingerprint_extractor_unique").on(
    table.jobFingerprint,
    table.extractorVersion
  ),
  createdAtIdx: index("job_analyses_created_at_idx").on(table.createdAt),
}));

// Immutable versioned match outcomes. Deprecated job columns are cleared during startup cleanup.
export const matchResults = sqliteTable("match_results", {
  id: text("id").primaryKey(),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  candidateSnapshotId: text("candidate_snapshot_id").references(() => candidateSnapshots.id, { onDelete: "restrict" }),
  jobAnalysisId: text("job_analysis_id").references(() => jobAnalyses.id, { onDelete: "restrict" }),
  candidateFingerprint: text("candidate_fingerprint").notNull(),
  jobFingerprint: text("job_fingerprint").notNull(),
  scoringPolicyVersion: text("scoring_policy_version").notNull(),
  matchPolicyVersion: text("match_policy_version"),
  score: real("score").notNull(),
  breakdownJson: text("breakdown_json").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  confidence: real("confidence").notNull(), // Deprecated compatibility column; active AI matching stores 0.
  source: text("source").notNull(),
  adjudicationRunId: text("adjudication_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  matchRunId: text("match_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  isStale: integer("is_stale", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  artifactUnique: unique("match_results_artifact_unique").on(
    table.jobId,
    table.candidateFingerprint,
    table.jobFingerprint,
    table.scoringPolicyVersion
  ),
  jobCreatedIdx: index("match_results_job_created_idx").on(table.jobId, table.createdAt),
  freshnessIdx: index("match_results_freshness_idx").on(
    table.jobId,
    table.candidateFingerprint,
    table.jobFingerprint,
    table.scoringPolicyVersion,
    table.isStale
  ),
}));

// Match Sessions - Track batch match operations
export const matchSessions = sqliteTable("match_sessions", {
  id: text("id").primaryKey(), // UUID
  triggerSource: text("trigger_source").notNull(), // "manual" | "auto_match" | "company_refresh" | "match_unmatched"
  companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }), // nullable, for company-specific matches
  status: text("status").notNull().default("in_progress"), // "queued" | "in_progress" | "completed" | "failed"
  jobsTotal: integer("jobs_total").default(0),
  jobsCompleted: integer("jobs_completed").default(0),
  jobsSucceeded: integer("jobs_succeeded").default(0),
  jobsFailed: integer("jobs_failed").default(0),
  errorCount: integer("error_count").default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
}, (table) => ({
  startedIdIdx: index("match_sessions_started_id_idx").on(table.startedAt, table.id),
  companyStartedIdIdx: index("match_sessions_company_started_id_idx").on(table.companyId, table.startedAt, table.id),
}));

// Match Logs - Per-job match results with history
export const matchLogs = sqliteTable("match_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").references(() => matchSessions.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // "success" | "failed"
  score: real("score"), // Match score if successful
  matchResultId: text("match_result_id").references(() => matchResults.id),
  attemptCount: integer("attempt_count").default(1),
  errorType: text("error_type"),
  errorMessage: text("error_message"),
  duration: integer("duration"),
  modelUsed: text("model_used"),
  completedAt: integer("completed_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  sessionIdIdx: index("match_logs_session_id_idx").on(table.sessionId),
  sessionCompletedIdIdx: index("match_logs_session_completed_id_idx").on(table.sessionId, table.completedAt, table.id),
  modelCompletedIdx: index("match_logs_model_completed_idx").on(
    table.modelUsed,
    table.completedAt
  ),
}));

// Durable per-job pipeline state for live analysis and matching progress.
export const matchSessionJobs = sqliteTable("match_session_jobs", {
  sessionId: text("session_id")
    .references(() => matchSessions.id, { onDelete: "cascade" })
    .notNull(),
  jobId: integer("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull(),
  analysisStatus: text("analysis_status", {
    enum: ["queued", "analyzing", "ready", "cached", "failed"],
  }).notNull().default("queued"),
  matchStatus: text("match_status", {
    enum: ["blocked", "queued", "matching", "completed", "cached", "failed"],
  }).notNull().default("blocked"),
  jobAnalysisId: text("job_analysis_id")
    .references(() => jobAnalyses.id, { onDelete: "set null" }),
  analysisRunId: text("analysis_run_id")
    .references(() => aiRuns.id, { onDelete: "set null" }),
  matchRunId: text("match_run_id")
    .references(() => aiRuns.id, { onDelete: "set null" }),
  matchResultId: text("match_result_id")
    .references(() => matchResults.id, { onDelete: "set null" }),
  errorStage: text("error_stage", { enum: ["analysis", "matching"] }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  analysisStartedAt: integer("analysis_started_at", { mode: "timestamp" }),
  analysisCompletedAt: integer("analysis_completed_at", { mode: "timestamp" }),
  matchStartedAt: integer("match_started_at", { mode: "timestamp" }),
  matchCompletedAt: integer("match_completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.sessionId, table.jobId] }),
  sessionPipelineIdx: index("match_session_jobs_session_pipeline_idx").on(
    table.sessionId,
    table.analysisStatus,
    table.matchStatus
  ),
  sessionUpdatedJobIdx: index("match_session_jobs_session_updated_job_idx").on(
    table.sessionId,
    table.updatedAt,
    table.jobId
  ),
  jobIdx: index("match_session_jobs_job_idx").on(table.jobId),
}));

const aiGeneratedContentCurrentVariantRef = (): AnySQLiteColumn =>
  aiGenerationHistory.id;
const aiGenerationHistoryContentRef = (): AnySQLiteColumn =>
  aiGeneratedContent.id;

export const aiGeneratedContent = sqliteTable("aiGeneratedContent", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // "cover_letter" | "referral" | "recruiter_follow_up"
  content: text("content").notNull(),
  currentVariantId: integer("current_variant_id")
    .references(aiGeneratedContentCurrentVariantRef, { onDelete: "set null" }),
  settingsSnapshot: text("settings_snapshot"), // JSON - stores tone, length, focus used
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  jobTypeUnique: unique("aiGeneratedContentJobTypeUnique").on(table.jobId, table.type),
  currentVariantCheck: check(
    "ai_generated_content_current_variant_check",
    sql`${table.currentVariantId} is null or ${table.currentVariantId} > 0`
  ),
}));

// AI Generation History - Stores all variants/history of generated content
const aiGenHistParentVariantRef = () => aiGenerationHistory.id;
export const aiGenerationHistory = sqliteTable("aiGenerationHistory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentId: integer("content_id").references(aiGenerationHistoryContentRef, { onDelete: "cascade" }).notNull(),
  variant: text("variant").notNull(),
  userPrompt: text("user_prompt"), // If user asked for modifications
  parentVariantId: integer("parent_variant_id").references(aiGenHistParentVariantRef, { onDelete: "cascade" }), // If derived from another variant
  aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
  source: text("source").notNull().default("generated"), // "generated" | "manual_edit"
  selectedAt: integer("selected_at", { mode: "timestamp" }),
  copiedAt: integer("copied_at", { mode: "timestamp" }),
  discardedAt: integer("discarded_at", { mode: "timestamp" }),
  editDistance: integer("edit_distance"),
  editDistanceRatio: real("edit_distance_ratio"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const aiGenerationEvents = sqliteTable("ai_generation_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  variantId: integer("variant_id")
    .references(() => aiGenerationHistory.id, { onDelete: "cascade" })
    .notNull(),
  action: text("action").notNull(),
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  variantCreatedIdx: index("ai_generation_events_variant_created_idx").on(
    table.variantId,
    table.createdAt
  ),
  actionCreatedIdx: index("ai_generation_events_action_created_idx").on(
    table.action,
    table.createdAt
  ),
  actionCheck: check(
    "ai_generation_events_action_check",
    sql`${table.action} in ('selected', 'copied', 'discarded')`
  ),
  sourceCheck: check(
    "ai_generation_events_source_check",
    sql`${table.source} in ('generated', 'initial_load', 'navigation', 'copy', 'discard')`
  ),
}));

export const people = sqliteTable("linkedin_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  identityKey: text("identity_key").notNull().unique(),
  source: text("source").notNull().default("linkedin"), // "linkedin" | "apollo" | "manual"
  sourceRecordKey: text("source_record_key"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name").notNull(),
  profileUrl: text("profile_url").notNull(),
  profileUrlNormalized: text("profile_url_normalized").notNull(),
  email: text("email"),
  companyRaw: text("company_raw"),
  companyNormalized: text("company_normalized"),
  position: text("position"),
  connectedOn: integer("connected_on", { mode: "timestamp" }),
  mappedCompanyId: integer("mapped_company_id").references(() => companies.id, { onDelete: "set null" }),
  isStarred: integer("is_starred", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  roleTag: text("role_tag"),
  roleTagSource: text("role_tag_source"), // "manual" | "inferred"
  notes: text("notes"),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  mappedCompanyIdIdx: index("linkedin_connections_mapped_company_idx").on(table.mappedCompanyId),
  isActiveIdx: index("linkedin_connections_active_idx").on(table.isActive),
  activeLastSeenIdIdx: index("linkedin_connections_active_last_seen_id_idx").on(table.isActive, table.lastSeenAt, table.id),
  isStarredIdx: index("linkedin_connections_star_idx").on(table.isStarred),
  companyNormalizedIdx: index("linkedin_connections_company_norm_idx").on(table.companyNormalized),
  unmatchedLookupIdx: index("linkedin_connections_unmatched_lookup_idx").on(
    table.isActive,
    table.mappedCompanyId,
    table.companyNormalized
  ),
  unmatchedCompanyDetailIdx: index("linkedin_connections_unmatched_company_idx").on(
    table.companyNormalized,
    table.mappedCompanyId,
    table.isActive
  ),
  sourceRecordKeyIdx: index("people_source_record_key_idx").on(table.sourceRecordKey),
  sourceActiveIdx: index("people_source_active_idx").on(table.source, table.isActive),
  mappedCompanyActiveIdx: index("people_mapped_company_active_idx").on(table.mappedCompanyId, table.isActive),
  roleTagActiveIdx: index("people_role_tag_active_idx").on(table.roleTag, table.isActive),
  archivedAtIdx: index("people_archived_at_idx").on(table.archivedAt),
}));

export const peopleImportSessions = sqliteTable("connection_import_sessions", {
  id: text("id").primaryKey(),
  fileName: text("file_name").notNull(),
  source: text("source").notNull().default("linkedin"), // "linkedin" | "apollo"
  totalRows: integer("total_rows").notNull().default(0),
  insertedRows: integer("inserted_rows").notNull().default(0),
  updatedRows: integer("updated_rows").notNull().default(0),
  unchangedRows: integer("unchanged_rows").notNull().default(0),
  reactivatedRows: integer("reactivated_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  deactivatedRows: integer("deactivated_rows").notNull().default(0),
  invalidRows: integer("invalid_rows").notNull().default(0),
  unmatchedCompanyRows: integer("unmatched_company_rows").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  status: text("status").notNull().default("in_progress"),
  importMode: text("import_mode").notNull().default("merge"),
  errorMessage: text("error_message"),
}, (table) => ({
  startedIdIdx: index("people_import_sessions_started_id_idx").on(table.startedAt, table.id),
  totalRowsCheck: check("people_import_total_rows_check", sql`${table.totalRows} >= 0`),
  insertedRowsCheck: check("people_import_inserted_rows_check", sql`${table.insertedRows} >= 0`),
  updatedRowsCheck: check("people_import_updated_rows_check", sql`${table.updatedRows} >= 0`),
  deactivatedRowsCheck: check("people_import_deactivated_rows_check", sql`${table.deactivatedRows} >= 0`),
  invalidRowsCheck: check("people_import_invalid_rows_check", sql`${table.invalidRows} >= 0`),
  unmatchedCompanyRowsCheck: check("people_import_unmatched_rows_check", sql`${table.unmatchedCompanyRows} >= 0`),
}));

export const personSourceRecords = sqliteTable("person_source_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: integer("person_id").references(() => people.id, { onDelete: "cascade" }).notNull(),
  source: text("source").notNull(), // "linkedin" | "apollo" | "manual"
  sourceRecordKey: text("source_record_key").notNull(),
  stableIdentityKey: text("stable_identity_key"),
  identityKind: text("identity_kind"), // "linkedin_url" | "email" | "composite" | "manual"
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name").notNull(),
  profileUrl: text("profile_url").notNull(),
  profileUrlNormalized: text("profile_url_normalized"),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  companyRaw: text("company_raw"),
  companyNormalized: text("company_normalized"),
  position: text("position"),
  connectedOn: integer("connected_on", { mode: "timestamp" }),
  sourceNotes: text("source_notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  lastImportSessionId: text("last_import_session_id").references(() => peopleImportSessions.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  sourceRecordUnique: unique("person_source_records_source_key_unique").on(table.source, table.sourceRecordKey),
  personIdIdx: index("person_source_records_person_idx").on(table.personId),
  stableIdentityIdx: index("person_source_records_stable_identity_idx").on(table.stableIdentityKey),
  profileUrlIdx: index("person_source_records_profile_url_idx").on(table.profileUrlNormalized),
  emailIdx: index("person_source_records_email_idx").on(table.emailNormalized),
  sourceActiveIdx: index("person_source_records_source_active_idx").on(table.source, table.isActive),
  importSessionIdx: index("person_source_records_import_session_idx").on(table.lastImportSessionId),
}));

export const peopleImportIssues = sqliteTable("connection_import_issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").references(() => peopleImportSessions.id, { onDelete: "cascade" }).notNull(),
  rowNumber: integer("row_number").notNull(),
  kind: text("kind").notNull(), // "invalid" | "duplicate" | "ambiguous_identity"
  reason: text("reason").notNull(),
  sourceRecordKey: text("source_record_key"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  sessionRowIdx: index("people_import_issues_session_row_idx").on(table.sessionId, table.rowNumber, table.id),
  rowNumberCheck: check("people_import_issue_row_number_check", sql`${table.rowNumber} > 0`),
}));

export const companyAliases = sqliteTable("company_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyNormalized: text("company_normalized").notNull(),
  mappedCompanyId: integer("mapped_company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  companyNormalizedUnique: unique("company_aliases_company_normalized_unique").on(table.companyNormalized),
  mappedCompanyIdIdx: index("company_aliases_mapped_company_id_idx").on(table.mappedCompanyId),
}));

// Relations
export const profileRelations = relations(profile, ({ many }) => ({
  skills: many(skills),
  experience: many(experience),
  education: many(education),
  resumes: many(resumes),
}));

export const resumesRelations = relations(resumes, ({ one }) => ({
  profile: one(profile, {
    fields: [resumes.profileId],
    references: [profile.id],
  }),
}));

export const skillsRelations = relations(skills, ({ one }) => ({
  profile: one(profile, {
    fields: [skills.profileId],
    references: [profile.id],
  }),
}));

export const experienceRelations = relations(experience, ({ one }) => ({
  profile: one(profile, {
    fields: [experience.profileId],
    references: [profile.id],
  }),
}));

export const educationRelations = relations(education, ({ one }) => ({
  profile: one(profile, {
    fields: [education.profileId],
    references: [profile.id],
  }),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  jobs: many(jobs),
  scrapingLogs: many(scrapingLogs),
  people: many(people),
  companyAliases: many(companyAliases),
  scrapeQueueItems: many(scrapeQueueItems),
  scrapeMatchOutbox: many(scrapeMatchOutbox),
}));

export const companyAliasesRelations = relations(companyAliases, ({ one }) => ({
  mappedCompany: one(companies, {
    fields: [companyAliases.mappedCompanyId],
    references: [companies.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  company: one(companies, {
    fields: [jobs.companyId],
    references: [companies.id],
  }),
}));

export const scrapingLogsRelations = relations(scrapingLogs, ({ one }) => ({
  company: one(companies, {
    fields: [scrapingLogs.companyId],
    references: [companies.id],
  }),
  session: one(scrapeSessions, {
    fields: [scrapingLogs.sessionId],
    references: [scrapeSessions.id],
  }),
  matchOutbox: one(scrapeMatchOutbox),
}));

export const scrapeMatchOutboxRelations = relations(scrapeMatchOutbox, ({ one }) => ({
  scrapingLog: one(scrapingLogs, {
    fields: [scrapeMatchOutbox.scrapingLogId],
    references: [scrapingLogs.id],
  }),
  company: one(companies, {
    fields: [scrapeMatchOutbox.companyId],
    references: [companies.id],
  }),
  matchSession: one(matchSessions, {
    fields: [scrapeMatchOutbox.id],
    references: [matchSessions.id],
  }),
}));

export const scrapeSessionsRelations = relations(scrapeSessions, ({ many }) => ({
  logs: many(scrapingLogs),
  queueItems: many(scrapeQueueItems),
}));

export const scrapeQueueItemsRelations = relations(scrapeQueueItems, ({ one }) => ({
  session: one(scrapeSessions, {
    fields: [scrapeQueueItems.sessionId],
    references: [scrapeSessions.id],
  }),
  company: one(companies, {
    fields: [scrapeQueueItems.companyId],
    references: [companies.id],
  }),
}));

export const matchSessionsRelations = relations(matchSessions, ({ one, many }) => ({
  company: one(companies, {
    fields: [matchSessions.companyId],
    references: [companies.id],
  }),
  logs: many(matchLogs),
  jobs: many(matchSessionJobs),
  scrapeMatchOutbox: one(scrapeMatchOutbox),
}));

export const matchLogsRelations = relations(matchLogs, ({ one }) => ({
  session: one(matchSessions, {
    fields: [matchLogs.sessionId],
    references: [matchSessions.id],
  }),
  job: one(jobs, {
    fields: [matchLogs.jobId],
    references: [jobs.id],
  }),
  matchResult: one(matchResults, {
    fields: [matchLogs.matchResultId],
    references: [matchResults.id],
  }),
}));

export const matchSessionJobsRelations = relations(matchSessionJobs, ({ one }) => ({
  session: one(matchSessions, {
    fields: [matchSessionJobs.sessionId],
    references: [matchSessions.id],
  }),
  job: one(jobs, {
    fields: [matchSessionJobs.jobId],
    references: [jobs.id],
  }),
  jobAnalysis: one(jobAnalyses, {
    fields: [matchSessionJobs.jobAnalysisId],
    references: [jobAnalyses.id],
  }),
  analysisRun: one(aiRuns, {
    fields: [matchSessionJobs.analysisRunId],
    references: [aiRuns.id],
  }),
  matchRun: one(aiRuns, {
    fields: [matchSessionJobs.matchRunId],
    references: [aiRuns.id],
  }),
  matchResult: one(matchResults, {
    fields: [matchSessionJobs.matchResultId],
    references: [matchResults.id],
  }),
}));

export const aiGeneratedContentRelations = relations(aiGeneratedContent, ({ one, many }) => ({
  job: one(jobs, {
    fields: [aiGeneratedContent.jobId],
    references: [jobs.id],
  }),
  currentVariant: one(aiGenerationHistory, {
    fields: [aiGeneratedContent.currentVariantId],
    references: [aiGenerationHistory.id],
    relationName: "currentWritingVariant",
  }),
  history: many(aiGenerationHistory),
}));

export const aiGenerationHistoryRelations = relations(aiGenerationHistory, ({ one, many }) => ({
  content: one(aiGeneratedContent, {
    fields: [aiGenerationHistory.contentId],
    references: [aiGeneratedContent.id],
  }),
  selectedForContent: many(aiGeneratedContent, {
    relationName: "currentWritingVariant",
  }),
  parentVariant: one(aiGenerationHistory, {
    fields: [aiGenerationHistory.parentVariantId],
    references: [aiGenerationHistory.id],
  }),
  events: many(aiGenerationEvents),
}));

export const aiGenerationEventsRelations = relations(aiGenerationEvents, ({ one }) => ({
  variant: one(aiGenerationHistory, {
    fields: [aiGenerationEvents.variantId],
    references: [aiGenerationHistory.id],
  }),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  mappedCompany: one(companies, {
    fields: [people.mappedCompanyId],
    references: [companies.id],
  }),
  sourceRecords: many(personSourceRecords),
}));

export const personSourceRecordsRelations = relations(personSourceRecords, ({ one }) => ({
  person: one(people, {
    fields: [personSourceRecords.personId],
    references: [people.id],
  }),
  lastImportSession: one(peopleImportSessions, {
    fields: [personSourceRecords.lastImportSessionId],
    references: [peopleImportSessions.id],
  }),
}));

export const peopleImportSessionsRelations = relations(peopleImportSessions, ({ many }) => ({
  sourceRecords: many(personSourceRecords),
  issues: many(peopleImportIssues),
}));

export const peopleImportIssuesRelations = relations(peopleImportIssues, ({ one }) => ({
  session: one(peopleImportSessions, {
    fields: [peopleImportIssues.sessionId],
    references: [peopleImportSessions.id],
  }),
}));

// Type exports
export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type Experience = typeof experience.$inferSelect;
export type NewExperience = typeof experience.$inferInsert;
export type Education = typeof education.$inferSelect;
export type NewEducation = typeof education.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type ScrapingLog = typeof scrapingLogs.$inferSelect;
export type NewScrapingLog = typeof scrapingLogs.$inferInsert;
export type ScrapeMatchOutboxItem = typeof scrapeMatchOutbox.$inferSelect;
export type NewScrapeMatchOutboxItem = typeof scrapeMatchOutbox.$inferInsert;
export type ScrapeSession = typeof scrapeSessions.$inferSelect;
export type NewScrapeSession = typeof scrapeSessions.$inferInsert;
export type ScrapeQueueItem = typeof scrapeQueueItems.$inferSelect;
export type NewScrapeQueueItem = typeof scrapeQueueItems.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type MatchSession = typeof matchSessions.$inferSelect;
export type NewMatchSession = typeof matchSessions.$inferInsert;
export type MatchLog = typeof matchLogs.$inferSelect;
export type NewMatchLog = typeof matchLogs.$inferInsert;
export type MatchSessionJob = typeof matchSessionJobs.$inferSelect;
export type NewMatchSessionJob = typeof matchSessionJobs.$inferInsert;
export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
export type AIWorkItem = typeof aiWorkItems.$inferSelect;
export type NewAIWorkItem = typeof aiWorkItems.$inferInsert;
export type AIGeneratedContent = typeof aiGeneratedContent.$inferSelect;
export type NewAIGeneratedContent = typeof aiGeneratedContent.$inferInsert;
export type AIGenerationHistory = typeof aiGenerationHistory.$inferSelect;
export type NewAIGenerationHistory = typeof aiGenerationHistory.$inferInsert;
export type AIProviderRecord = typeof aiProviders.$inferSelect;
export type NewAIProviderRecord = typeof aiProviders.$inferInsert;
export type CandidateSnapshot = typeof candidateSnapshots.$inferSelect;
export type NewCandidateSnapshot = typeof candidateSnapshots.$inferInsert;
export type JobAnalysis = typeof jobAnalyses.$inferSelect;
export type NewJobAnalysis = typeof jobAnalyses.$inferInsert;
export type PersistedMatchResult = typeof matchResults.$inferSelect;
export type NewPersistedMatchResult = typeof matchResults.$inferInsert;
export type AIRun = typeof aiRuns.$inferSelect;
export type NewAIRun = typeof aiRuns.$inferInsert;
export type AIRunAttempt = typeof aiRunAttempts.$inferSelect;
export type NewAIRunAttempt = typeof aiRunAttempts.$inferInsert;
export type AICacheEvent = typeof aiCacheEvents.$inferSelect;
export type NewAICacheEvent = typeof aiCacheEvents.$inferInsert;
export type AIGenerationEvent = typeof aiGenerationEvents.$inferSelect;
export type NewAIGenerationEvent = typeof aiGenerationEvents.$inferInsert;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PersonSourceRecord = typeof personSourceRecords.$inferSelect;
export type NewPersonSourceRecord = typeof personSourceRecords.$inferInsert;
export type PeopleImportSession = typeof peopleImportSessions.$inferSelect;
export type NewPeopleImportSession = typeof peopleImportSessions.$inferInsert;
export type PeopleImportIssue = typeof peopleImportIssues.$inferSelect;
export type NewPeopleImportIssue = typeof peopleImportIssues.$inferInsert;
export type CompanyAlias = typeof companyAliases.$inferSelect;
export type NewCompanyAlias = typeof companyAliases.$inferInsert;
