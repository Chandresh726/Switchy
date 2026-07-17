import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { normalizeCareersUrl } from "@/lib/companies/normalization";
import { JOB_STATUSES } from "@/lib/jobs/status";

import type * as databaseSchema from "./schema";
import {
  companies,
  education,
  experience,
  jobs,
  peopleImportSessions,
  profile,
  resumes,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
  skills,
} from "./schema";

export interface PersistencePreflightReport {
  existingSchema: boolean;
  profileCount: number;
  exactCompanyUrlDuplicates: number;
  normalizedCompanyUrlDuplicates: number;
  duplicateResumeVersions: number;
  profilesWithMultipleCurrentResumes: number;
  nullProfileOwnershipRows: number;
  invalidJobStatuses: number;
  invalidMatchScores: number;
  invalidNonNegativeCounters: number;
}

export class PersistencePreflightError extends Error {
  constructor(readonly report: PersistencePreflightReport) {
    const violations = Object.entries(report)
      .filter(([key, value]) => key !== "existingSchema" && key !== "profileCount" && value > 0)
      .map(([key, value]) => `${key}=${value}`);
    if (report.profileCount > 1) violations.push(`profileCount=${report.profileCount}`);
    super(`Database invariants must be repaired before migration: ${violations.join(", ")}`);
    this.name = "PersistencePreflightError";
  }
}

function duplicateCount(values: string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function duplicateGroupCount(values: string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).length;
}

export function runPersistencePreflight(
  database: BetterSQLite3Database<typeof databaseSchema>
): PersistencePreflightReport {
  let companyRows: Array<{ careersUrl: string }>;
  try {
    companyRows = database.select({ careersUrl: companies.careersUrl }).from(companies).all();
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table: companies")) {
      return {
        existingSchema: false,
        profileCount: 0,
        exactCompanyUrlDuplicates: 0,
        normalizedCompanyUrlDuplicates: 0,
        duplicateResumeVersions: 0,
        profilesWithMultipleCurrentResumes: 0,
        nullProfileOwnershipRows: 0,
        invalidJobStatuses: 0,
        invalidMatchScores: 0,
        invalidNonNegativeCounters: 0,
      };
    }
    throw error;
  }

  const profileRows = database.select({ id: profile.id }).from(profile).all();
  const resumeRows = database.select({
    profileId: resumes.profileId,
    version: resumes.version,
    isCurrent: resumes.isCurrent,
  }).from(resumes).all();
  const ownershipRows = [
    ...database.select({ profileId: skills.profileId }).from(skills).all(),
    ...database.select({ profileId: experience.profileId }).from(experience).all(),
    ...database.select({ profileId: education.profileId }).from(education).all(),
  ];
  const jobRows = database.select({ status: jobs.status, matchScore: jobs.matchScore }).from(jobs).all();
  const scrapeSessionRows = database.select({
    companiesTotal: scrapeSessions.companiesTotal,
    companiesCompleted: scrapeSessions.companiesCompleted,
    totalJobsFound: scrapeSessions.totalJobsFound,
    totalJobsAdded: scrapeSessions.totalJobsAdded,
    totalJobsFiltered: scrapeSessions.totalJobsFiltered,
    totalJobsArchived: scrapeSessions.totalJobsArchived,
  }).from(scrapeSessions).all();
  const queueRows = database.select({
    attemptCount: scrapeQueueItems.attemptCount,
    maxAttempts: scrapeQueueItems.maxAttempts,
  }).from(scrapeQueueItems).all();
  const outboxRows = database.select({
    attemptCount: scrapeMatchOutbox.attemptCount,
    maxAttempts: scrapeMatchOutbox.maxAttempts,
  }).from(scrapeMatchOutbox).all();
  const scrapingLogRows = database.select({
    jobsFound: scrapingLogs.jobsFound,
    jobsAdded: scrapingLogs.jobsAdded,
    jobsUpdated: scrapingLogs.jobsUpdated,
    jobsFiltered: scrapingLogs.jobsFiltered,
    jobsArchived: scrapingLogs.jobsArchived,
    duration: scrapingLogs.duration,
    matcherJobsTotal: scrapingLogs.matcherJobsTotal,
    matcherJobsCompleted: scrapingLogs.matcherJobsCompleted,
    matcherDuration: scrapingLogs.matcherDuration,
    matcherErrorCount: scrapingLogs.matcherErrorCount,
  }).from(scrapingLogs).all();
  const importRows = database.select({
    totalRows: peopleImportSessions.totalRows,
    insertedRows: peopleImportSessions.insertedRows,
    updatedRows: peopleImportSessions.updatedRows,
    deactivatedRows: peopleImportSessions.deactivatedRows,
    invalidRows: peopleImportSessions.invalidRows,
    unmatchedCompanyRows: peopleImportSessions.unmatchedCompanyRows,
  }).from(peopleImportSessions).all();
  const resumeVersions = resumeRows.map((row) => `${row.profileId ?? "null"}:${row.version}`);
  const currentProfiles = resumeRows.filter((row) => row.isCurrent)
    .map((row) => String(row.profileId ?? "null"));
  const report: PersistencePreflightReport = {
    existingSchema: true,
    profileCount: profileRows.length,
    exactCompanyUrlDuplicates: duplicateCount(companyRows.map(({ careersUrl }) => careersUrl)),
    normalizedCompanyUrlDuplicates: duplicateCount(
      companyRows.map(({ careersUrl }) => normalizeCareersUrl(careersUrl))
    ),
    duplicateResumeVersions: duplicateCount(resumeVersions),
    profilesWithMultipleCurrentResumes: duplicateGroupCount(currentProfiles),
    nullProfileOwnershipRows: resumeRows.filter((row) => row.profileId === null).length +
      ownershipRows.filter((row) => row.profileId === null).length,
    invalidJobStatuses: jobRows.filter((row) =>
      !JOB_STATUSES.includes(row.status)
    ).length,
    invalidMatchScores: jobRows.filter((row) =>
      row.matchScore !== null && (row.matchScore < 0 || row.matchScore > 100)
    ).length,
    invalidNonNegativeCounters: [
      ...scrapeSessionRows.flatMap(Object.values),
      ...scrapingLogRows.flatMap(Object.values),
      ...importRows.flatMap(Object.values),
      ...queueRows.map(({ attemptCount }) => attemptCount),
      ...outboxRows.map(({ attemptCount }) => attemptCount),
    ].filter((value) => value !== null && value < 0).length +
      queueRows.filter(({ maxAttempts }) => maxAttempts <= 0).length +
      outboxRows.filter(({ maxAttempts }) => maxAttempts <= 0).length,
  };
  if (
    report.profileCount > 1 ||
    report.exactCompanyUrlDuplicates > 0 ||
    report.normalizedCompanyUrlDuplicates > 0 ||
    report.duplicateResumeVersions > 0 ||
    report.profilesWithMultipleCurrentResumes > 0 ||
    report.nullProfileOwnershipRows > 0 ||
    report.invalidJobStatuses > 0 ||
    report.invalidMatchScores > 0 ||
    report.invalidNonNegativeCounters > 0
  ) {
    throw new PersistencePreflightError(report);
  }
  return report;
}
