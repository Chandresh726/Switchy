import { sqliteTable, text, integer, real, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// Profile - Single user profile
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
});

// Resumes - Uploaded resumes and their parsed data
export const resumes = sqliteTable("resumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  parsedData: text("parsed_data").notNull(), // JSON string
  version: integer("version").notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Skills - User skills with proficiency levels
export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"), // e.g., "frontend", "backend", "devops", "soft skills"
  proficiency: integer("proficiency").notNull().default(3), // 1-5 scale
  yearsOfExperience: real("years_of_experience"),
});

// Experience - Work history
export const experience = sqliteTable("experience", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }),
  company: text("company").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"), // null = current
  description: text("description"),
  highlights: text("highlights"), // JSON array stored as text
});

// Education - Education history
export const education = sqliteTable("education", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").references(() => profile.id, { onDelete: "cascade" }),
  institution: text("institution").notNull(),
  degree: text("degree").notNull(),
  field: text("field"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  gpa: text("gpa"),
  honors: text("honors"),
});

// Companies - Tracked companies with careers page URLs
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  careersUrl: text("careers_url").notNull(),
  logoUrl: text("logo_url"),
  platform: text("platform"), // "greenhouse", "lever", "custom"
  boardToken: text("board_token"), // Manual board token for platforms like Greenhouse (when URL doesn't contain it)
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastScrapedAt: integer("last_scraped_at", { mode: "timestamp" }),
  scrapeFrequency: integer("scrape_frequency").default(6), // hours between scrapes
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

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
  status: text("status").notNull().default("new"), // "new", "viewed", "interested", "applied", "rejected", "archived"
  matchScore: real("match_score"), // 0-100
  matchReasons: text("match_reasons"), // JSON array
  matchedSkills: text("matched_skills"), // JSON array
  missingSkills: text("missing_skills"), // JSON array
  recommendations: text("recommendations"), // JSON array
  postedDate: integer("posted_date", { mode: "timestamp" }),
  discoveredAt: integer("discovered_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  viewedAt: integer("viewed_at", { mode: "timestamp" }),
  appliedAt: integer("applied_at", { mode: "timestamp" }),
});

// Job Requirements - Extracted requirements from job descriptions
export const jobRequirements = sqliteTable("job_requirements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  requirement: text("requirement").notNull(),
  type: text("type"), // "required", "preferred", "nice-to-have"
  category: text("category"), // "skill", "experience", "education", "certification"
});

// Scrape Sessions - Track batch scrape operations
export const scrapeSessions = sqliteTable("scrape_sessions", {
  id: text("id").primaryKey(), // UUID
  triggerSource: text("trigger_source").notNull(), // "manual" | "scheduler" | "company_refresh"
  status: text("status").notNull().default("in_progress"), // "in_progress" | "completed" | "failed"
  companiesTotal: integer("companies_total").default(0),
  companiesCompleted: integer("companies_completed").default(0),
  totalJobsFound: integer("total_jobs_found").default(0),
  totalJobsAdded: integer("total_jobs_added").default(0),
  totalJobsFiltered: integer("total_jobs_filtered").default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Scraping Logs - Audit trail for scraping operations
export const scrapingLogs = sqliteTable("scraping_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => scrapeSessions.id, { onDelete: "cascade" }),
  triggerSource: text("trigger_source"), // "manual" | "scheduler" | "company_refresh"
  status: text("status").notNull(), // "success", "error", "partial"
  jobsFound: integer("jobs_found").default(0),
  jobsAdded: integer("jobs_added").default(0),
  jobsUpdated: integer("jobs_updated").default(0),
  jobsFiltered: integer("jobs_filtered").default(0), // Jobs filtered by location preference
  platform: text("platform"), // "greenhouse" | "lever" etc.
  errorMessage: text("error_message"),
  duration: integer("duration"), // milliseconds
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  // Matcher tracking
  matcherStatus: text("matcher_status"), // "pending" | "in_progress" | "completed" | "failed"
  matcherJobsTotal: integer("matcher_jobs_total"),
  matcherJobsCompleted: integer("matcher_jobs_completed"),
  matcherDuration: integer("matcher_duration"),
  matcherErrorCount: integer("matcher_error_count").default(0),
});

// Matcher Errors - Track individual job matcher failures for debugging
export const matcherErrors = sqliteTable("matcher_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  scrapingLogId: integer("scraping_log_id").references(() => scrapingLogs.id, { onDelete: "set null" }),
  attemptNumber: integer("attempt_number").notNull(), // 1-based retry count
  errorType: text("error_type").notNull(), // "network", "validation", "rate_limit", "json_parse", "unknown"
  errorMessage: text("error_message").notNull(),
  occurredAt: integer("occurred_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Settings - App configuration key-value store
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Match Sessions - Track batch match operations
export const matchSessions = sqliteTable("match_sessions", {
  id: text("id").primaryKey(), // UUID
  triggerSource: text("trigger_source").notNull(), // "manual" | "scheduler" | "company_refresh"
  companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }), // nullable, for company-specific matches
  status: text("status").notNull().default("in_progress"), // "in_progress" | "completed" | "failed"
  jobsTotal: integer("jobs_total").default(0),
  jobsCompleted: integer("jobs_completed").default(0),
  jobsSucceeded: integer("jobs_succeeded").default(0),
  jobsFailed: integer("jobs_failed").default(0),
  errorCount: integer("error_count").default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Match Logs - Per-job match results with history
export const matchLogs = sqliteTable("match_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").references(() => matchSessions.id, { onDelete: "cascade" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // "success" | "failed"
  score: real("score"), // Match score if successful
  attemptCount: integer("attempt_count").default(1),
  errorType: text("error_type"),
  errorMessage: text("error_message"),
  duration: integer("duration"),
  modelUsed: text("model_used"),
  completedAt: integer("completed_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const aiGeneratedContent = sqliteTable("aiGeneratedContent", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // "cover_letter" | "referral"
  content: text("content").notNull(),
  settingsSnapshot: text("settings_snapshot"), // JSON - stores tone, length, focus used
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  jobTypeUnique: unique("aiGeneratedContentJobTypeUnique").on(table.jobId, table.type),
}));

// AI Generation History - Stores all variants/history of generated content
const aiGenHistParentVariantRef = () => aiGenerationHistory.id;
export const aiGenerationHistory = sqliteTable("aiGenerationHistory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentId: integer("content_id").references(() => aiGeneratedContent.id, { onDelete: "cascade" }).notNull(),
  variant: text("variant").notNull(),
  userPrompt: text("user_prompt"), // If user asked for modifications
  parentVariantId: integer("parent_variant_id").references(aiGenHistParentVariantRef, { onDelete: "cascade" }), // If derived from another variant
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

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
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  company: one(companies, {
    fields: [jobs.companyId],
    references: [companies.id],
  }),
  requirements: many(jobRequirements),
}));

export const jobRequirementsRelations = relations(jobRequirements, ({ one }) => ({
  job: one(jobs, {
    fields: [jobRequirements.jobId],
    references: [jobs.id],
  }),
}));

export const scrapingLogsRelations = relations(scrapingLogs, ({ one, many }) => ({
  company: one(companies, {
    fields: [scrapingLogs.companyId],
    references: [companies.id],
  }),
  session: one(scrapeSessions, {
    fields: [scrapingLogs.sessionId],
    references: [scrapeSessions.id],
  }),
  matcherErrors: many(matcherErrors),
}));

export const matcherErrorsRelations = relations(matcherErrors, ({ one }) => ({
  job: one(jobs, {
    fields: [matcherErrors.jobId],
    references: [jobs.id],
  }),
  scrapingLog: one(scrapingLogs, {
    fields: [matcherErrors.scrapingLogId],
    references: [scrapingLogs.id],
  }),
}));

export const scrapeSessionsRelations = relations(scrapeSessions, ({ many }) => ({
  logs: many(scrapingLogs),
}));

export const matchSessionsRelations = relations(matchSessions, ({ one, many }) => ({
  company: one(companies, {
    fields: [matchSessions.companyId],
    references: [companies.id],
  }),
  logs: many(matchLogs),
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
}));

export const aiGeneratedContentRelations = relations(aiGeneratedContent, ({ one, many }) => ({
  job: one(jobs, {
    fields: [aiGeneratedContent.jobId],
    references: [jobs.id],
  }),
  history: many(aiGenerationHistory),
}));

export const aiGenerationHistoryRelations = relations(aiGenerationHistory, ({ one }) => ({
  content: one(aiGeneratedContent, {
    fields: [aiGenerationHistory.contentId],
    references: [aiGeneratedContent.id],
  }),
  parentVariant: one(aiGenerationHistory, {
    fields: [aiGenerationHistory.parentVariantId],
    references: [aiGenerationHistory.id],
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
export type JobRequirement = typeof jobRequirements.$inferSelect;
export type NewJobRequirement = typeof jobRequirements.$inferInsert;
export type ScrapingLog = typeof scrapingLogs.$inferSelect;
export type NewScrapingLog = typeof scrapingLogs.$inferInsert;
export type ScrapeSession = typeof scrapeSessions.$inferSelect;
export type NewScrapeSession = typeof scrapeSessions.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type MatcherError = typeof matcherErrors.$inferSelect;
export type NewMatcherError = typeof matcherErrors.$inferInsert;
export type MatchSession = typeof matchSessions.$inferSelect;
export type NewMatchSession = typeof matchSessions.$inferInsert;
export type MatchLog = typeof matchLogs.$inferSelect;
export type NewMatchLog = typeof matchLogs.$inferInsert;
export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
export type AIGeneratedContent = typeof aiGeneratedContent.$inferSelect;
export type NewAIGeneratedContent = typeof aiGeneratedContent.$inferInsert;
export type AIGenerationHistory = typeof aiGenerationHistory.$inferSelect;
export type NewAIGenerationHistory = typeof aiGenerationHistory.$inferInsert;
