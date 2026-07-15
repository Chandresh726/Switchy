import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import {
  buildCandidateEvidence,
  buildCandidateFingerprint,
  buildJobEvidenceInput,
  buildJobFingerprint,
  MatchBreakdownSchema,
  MatchEvidenceSchema,
  type MatchBand,
  type MatchBreakdown,
  type MatchConstraint,
  type MatchEvidence,
  type RequirementAssessment,
} from "@/lib/ai/artifacts";
import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";
import { db } from "@/lib/db";
import { aiProviders, jobs, matchResults } from "@/lib/db/schema";

import { getMatcherConfig } from "./config";
import { buildScoringPolicyVersion } from "./evidence/adjudication";
import { enrichCandidateEvidence } from "./evidence/candidate";
import { fetchMatchingPreferences, fetchProfileData } from "./tracking";

const MATCH_RESULT_QUERY_BATCH_SIZE = 400;
const EXACT_MATCH_QUERY_BATCH_SIZE = 200;

type MatchableJob = Pick<
  typeof jobs.$inferSelect,
  | "id"
  | "title"
  | "description"
  | "location"
  | "locationType"
  | "seniorityLevel"
  | "department"
  | "employmentType"
  | "salary"
  | "matchScore"
  | "matchReasons"
  | "matchedSkills"
  | "missingSkills"
  | "recommendations"
>;

type PresentationMatchRow = Pick<
  typeof matchResults.$inferSelect,
  | "id"
  | "jobId"
  | "candidateFingerprint"
  | "jobFingerprint"
  | "scoringPolicyVersion"
  | "score"
  | "breakdownJson"
  | "evidenceJson"
  | "confidence"
  | "source"
  | "isStale"
  | "createdAt"
>;

export interface CurrentMatchContext {
  candidateFingerprint: string;
  scoringPolicyVersion: string;
}

export interface MatchPresentation {
  matchScore: number | null;
  matchReasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  recommendations: string[];
  matchResultId: string | null;
  matchConfidence: number | null;
  matchBreakdown: MatchBreakdown | null;
  matchStale: boolean;
  matchLegacy: boolean;
  matchSummary: string;
  matchBand: MatchBand | null;
  matchRoleFitScore: number | null;
  matchEvidenceCoverage: number | null;
  matchExtractionConfidence: number | null;
  matchConstraints: MatchConstraint[];
  matchRequirementAssessments: RequirementAssessment[];
  scoringPolicyVersion: string | null;
}

interface MatchPresentationOptions {
  includeStale?: boolean;
}

const EMPTY_MATCH_PRESENTATION: MatchPresentation = {
  matchScore: null,
  matchReasons: [],
  matchedSkills: [],
  missingSkills: [],
  recommendations: [],
  matchResultId: null,
  matchConfidence: null,
  matchBreakdown: null,
  matchStale: false,
  matchLegacy: false,
  matchSummary: "",
  matchBand: null,
  matchRoleFitScore: null,
  matchEvidenceCoverage: null,
  matchExtractionConfidence: null,
  matchConstraints: [],
  matchRequirementAssessments: [],
  scoringPolicyVersion: null,
};

function parseLegacyStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function buildLegacyPresentation(job: MatchableJob): MatchPresentation | null {
  if (job.matchScore === null) return null;
  return {
    matchScore: job.matchScore,
    matchReasons: parseLegacyStringArray(job.matchReasons),
    matchedSkills: parseLegacyStringArray(job.matchedSkills),
    missingSkills: parseLegacyStringArray(job.missingSkills),
    recommendations: parseLegacyStringArray(job.recommendations),
    matchResultId: null,
    matchConfidence: null,
    matchBreakdown: null,
    matchStale: false,
    matchLegacy: true,
    matchSummary: "",
    matchBand: null,
    matchRoleFitScore: null,
    matchEvidenceCoverage: null,
    matchExtractionConfidence: null,
    matchConstraints: [],
    matchRequirementAssessments: [],
    scoringPolicyVersion: "legacy",
  };
}

async function resolveActiveProviderId(configuredProviderId?: string): Promise<string | null> {
  const rows = configuredProviderId
    ? await db.select({ id: aiProviders.id }).from(aiProviders).where(and(
        eq(aiProviders.id, configuredProviderId),
        eq(aiProviders.isActive, true)
      )).limit(1)
    : await db.select({ id: aiProviders.id }).from(aiProviders)
        .where(eq(aiProviders.isActive, true))
        .orderBy(desc(aiProviders.isDefault), asc(aiProviders.createdAt))
        .limit(1);
  return rows[0]?.id ?? null;
}

export async function getCurrentMatchContext(): Promise<CurrentMatchContext | null> {
  const [config, profileData, preferences] = await Promise.all([
    getMatcherConfig(),
    fetchProfileData(),
    fetchMatchingPreferences(),
  ]);
  if (!profileData || !config.model) return null;

  const providerId = await resolveActiveProviderId(config.providerId);
  if (!providerId) return null;

  const candidateEvidence = enrichCandidateEvidence(buildCandidateEvidence({
    ...profileData,
    preferences,
  }));

  return {
    candidateFingerprint: buildCandidateFingerprint(candidateEvidence),
    scoringPolicyVersion: buildScoringPolicyVersion({
      ...config,
      providerId,
    }),
  };
}

function parseMatchRow(row: PresentationMatchRow): {
  presentation: MatchPresentation;
  candidateFingerprint: string;
  jobFingerprint: string;
  isStale: boolean;
} {
  const evidence: MatchEvidence = MatchEvidenceSchema.parse(JSON.parse(row.evidenceJson));
  const breakdown = MatchBreakdownSchema.parse(JSON.parse(row.breakdownJson));
  return {
    presentation: {
      matchScore: row.score,
      matchReasons: evidence.reasons,
      matchedSkills: evidence.matchedSkills,
      missingSkills: evidence.missingSkills,
      recommendations: evidence.recommendations,
      matchResultId: row.id,
      matchConfidence: row.confidence,
      matchBreakdown: breakdown,
      matchStale: false,
      matchLegacy: row.source === "legacy",
      matchSummary: evidence.summary,
      matchBand: evidence.matchBand,
      matchRoleFitScore: evidence.roleFitScore,
      matchEvidenceCoverage: evidence.evidenceCoverage,
      matchExtractionConfidence: evidence.extractionConfidence,
      matchConstraints: evidence.constraints,
      matchRequirementAssessments: evidence.requirementAssessments,
      scoringPolicyVersion: row.scoringPolicyVersion,
    },
    candidateFingerprint: row.candidateFingerprint,
    jobFingerprint: row.jobFingerprint,
    isStale: row.isStale,
  };
}

export function selectMatchPresentation(
  job: MatchableJob,
  rowsInput: PresentationMatchRow[],
  context: CurrentMatchContext | null,
  jobFingerprintInput?: string | null
): MatchPresentation {
  const rows = [...rowsInput].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
  );
  const latest = rows[0] ? parseMatchRow(rows[0]) : null;
  const jobFingerprint = jobFingerprintInput === undefined
    ? getJobFingerprint(job)
    : jobFingerprintInput;
  const freshRow = context && jobFingerprint
    ? rows.find((row) =>
        !row.isStale &&
        row.candidateFingerprint === context.candidateFingerprint &&
        row.jobFingerprint === jobFingerprint &&
        row.scoringPolicyVersion === context.scoringPolicyVersion
      )
    : undefined;

  if (freshRow) return parseMatchRow(freshRow).presentation;
  if (latest?.presentation.matchLegacy) {
    return {
      ...latest.presentation,
      matchConfidence: null,
      matchBreakdown: null,
      matchStale: false,
    };
  }
  const legacy = buildLegacyPresentation(job);
  if (legacy) return legacy;
  if (latest) {
    return {
      ...latest.presentation,
      matchScore: null,
      matchStale: true,
    };
  }
  return {
    ...EMPTY_MATCH_PRESENTATION,
    scoringPolicyVersion: context?.scoringPolicyVersion ?? null,
  };
}

function getJobFingerprint(job: MatchableJob): string | null {
  try {
    return buildJobFingerprint(buildJobEvidenceInput(job));
  } catch {
    // Invalid legacy job content cannot produce a current versioned result.
    return null;
  }
}

async function findExactCurrentRows(
  jobRows: MatchableJob[],
  fingerprints: Map<number, string | null>,
  context: CurrentMatchContext
): Promise<PresentationMatchRow[]> {
  const resultRows: PresentationMatchRow[] = [];

  for (let offset = 0; offset < jobRows.length; offset += EXACT_MATCH_QUERY_BATCH_SIZE) {
    const batch = jobRows.slice(offset, offset + EXACT_MATCH_QUERY_BATCH_SIZE);
    const exactConditions = batch.flatMap((job) => {
      const fingerprint = fingerprints.get(job.id);
      return fingerprint
        ? [and(
            eq(matchResults.jobId, job.id),
            eq(matchResults.jobFingerprint, fingerprint)
          )]
        : [];
    });
    const exactJobs = or(...exactConditions);
    if (!exactJobs) continue;

    resultRows.push(...await db.select().from(matchResults).where(and(
      eq(matchResults.candidateFingerprint, context.candidateFingerprint),
      eq(matchResults.scoringPolicyVersion, context.scoringPolicyVersion),
      eq(matchResults.isStale, false),
      exactJobs
    )));
  }

  return resultRows;
}

async function findLatestRows(jobIds: number[]): Promise<PresentationMatchRow[]> {
  const resultRows: PresentationMatchRow[] = [];

  for (let offset = 0; offset < jobIds.length; offset += MATCH_RESULT_QUERY_BATCH_SIZE) {
    const batch = jobIds.slice(offset, offset + MATCH_RESULT_QUERY_BATCH_SIZE);
    const ranked = db.select({
      ...getTableColumns(matchResults),
      rowNumber: sql<number>`row_number() over (
        partition by ${matchResults.jobId}
        order by ${matchResults.createdAt} desc, ${matchResults.id} desc
      )`.as("row_number"),
    }).from(matchResults)
      .where(inArray(matchResults.jobId, batch))
      .as("ranked_match_results");
    const rows = await db.select({
      id: ranked.id,
      jobId: ranked.jobId,
      candidateFingerprint: ranked.candidateFingerprint,
      jobFingerprint: ranked.jobFingerprint,
      scoringPolicyVersion: ranked.scoringPolicyVersion,
      score: ranked.score,
      breakdownJson: ranked.breakdownJson,
      evidenceJson: ranked.evidenceJson,
      confidence: ranked.confidence,
      source: ranked.source,
      isStale: ranked.isStale,
      createdAt: ranked.createdAt,
    }).from(ranked).where(eq(ranked.rowNumber, 1));
    resultRows.push(...rows);
  }

  return resultRows;
}

export async function getMatchPresentations(
  jobRows: MatchableJob[],
  contextInput?: CurrentMatchContext | null,
  options: MatchPresentationOptions = {}
): Promise<Map<number, MatchPresentation>> {
  if (jobRows.length === 0) return new Map();
  const context = contextInput === undefined
    ? await getCurrentMatchContext()
    : contextInput;
  const fingerprints = new Map(jobRows.map((job) => [job.id, getJobFingerprint(job)]));
  const resultRows = context
    ? await findExactCurrentRows(jobRows, fingerprints, context)
    : [];

  const rowsByJobId = new Map<number, PresentationMatchRow[]>();
  for (const row of resultRows) {
    const existing = rowsByJobId.get(row.jobId) ?? [];
    existing.push(row);
    rowsByJobId.set(row.jobId, existing);
  }

  if (options.includeStale !== false) {
    const missingJobIds = jobRows
      .filter((job) => !rowsByJobId.has(job.id))
      .map((job) => job.id);
    for (const row of await findLatestRows(missingJobIds)) {
      rowsByJobId.set(row.jobId, [row]);
    }
  }

  return new Map(jobRows.map((job) => [
    job.id,
    selectMatchPresentation(
      job,
      rowsByJobId.get(job.id) ?? [],
      context,
      fingerprints.get(job.id)
    ),
  ]));
}

export async function getFreshUnmatchedJobIds(
  contextInput?: CurrentMatchContext | null
): Promise<number[]> {
  const context = contextInput === undefined
    ? await getCurrentMatchContext()
    : contextInput;
  if (!context) {
    return (await db.select({ id: jobs.id }).from(jobs)
      .where(isNull(jobs.matchScore))).map((job) => job.id);
  }
  ensureJobFingerprintProjection();
  const currentResultJoin = and(
    eq(matchResults.jobId, jobs.id),
    eq(matchResults.candidateFingerprint, context.candidateFingerprint),
    eq(matchResults.jobFingerprint, jobs.aiFingerprint),
    eq(matchResults.scoringPolicyVersion, context.scoringPolicyVersion),
    eq(matchResults.isStale, false)
  );
  const rows = await db.select({ id: jobs.id }).from(jobs)
    .leftJoin(matchResults, currentResultJoin)
    .where(and(isNull(matchResults.id), isNull(jobs.matchScore)));
  return rows.map((job) => job.id);
}

export async function getMatchPresentationsForJobIds(
  jobIds?: number[]
): Promise<Map<number, MatchPresentation>> {
  const jobRows = await getMatchableJobsByIds(jobIds);
  return getMatchPresentations(jobRows);
}

async function getMatchableJobsByIds(jobIds?: number[]): Promise<MatchableJob[]> {
  if (jobIds && jobIds.length === 0) return [];
  const query = db.select({
    id: jobs.id,
    title: jobs.title,
    description: jobs.description,
    location: jobs.location,
    locationType: jobs.locationType,
    seniorityLevel: jobs.seniorityLevel,
    department: jobs.department,
    employmentType: jobs.employmentType,
    salary: jobs.salary,
    matchScore: jobs.matchScore,
    matchReasons: jobs.matchReasons,
    matchedSkills: jobs.matchedSkills,
    missingSkills: jobs.missingSkills,
    recommendations: jobs.recommendations,
  }).from(jobs);
  return jobIds
    ? query.where(inArray(jobs.id, jobIds))
    : query;
}

export async function getFreshUnmatchedJobCount(
  contextInput?: CurrentMatchContext | null
): Promise<number> {
  const context = contextInput === undefined
    ? await getCurrentMatchContext()
    : contextInput;
  if (!context) {
    const [result] = await db.select({ value: count() }).from(jobs)
      .where(isNull(jobs.matchScore));
    return result?.value ?? 0;
  }
  ensureJobFingerprintProjection();
  const currentResultJoin = and(
    eq(matchResults.jobId, jobs.id),
    eq(matchResults.candidateFingerprint, context.candidateFingerprint),
    eq(matchResults.jobFingerprint, jobs.aiFingerprint),
    eq(matchResults.scoringPolicyVersion, context.scoringPolicyVersion),
    eq(matchResults.isStale, false)
  );
  const [result] = await db.select({ value: count() }).from(jobs)
    .leftJoin(matchResults, currentResultJoin)
    .where(and(isNull(matchResults.id), isNull(jobs.matchScore)));
  return result?.value ?? 0;
}
