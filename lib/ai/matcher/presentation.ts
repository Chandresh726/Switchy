import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  notInArray,
} from "drizzle-orm";

import {
  buildCandidateEvidence,
  buildCandidateFingerprint,
  MatchBreakdownSchema,
  MatchEvidenceSchema,
  type MatchBreakdown,
  type MatchEvidence,
  type MatchReasoningPoint,
} from "@/lib/ai/artifacts";
import { isLocalCLIProvider } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { aiProviders, jobs, matchResults } from "@/lib/db/schema";

import { fetchCandidateProfileSnapshot } from "@/lib/ai/profile/profile-snapshot";
import { buildPreferredMatchResultId } from "./presentation-query";
import { getMatcherConfig } from "./config";
import { buildMatchPolicyVersion } from "./evidence/ai-match";
import { enrichCandidateEvidence } from "./evidence/candidate";
import { buildJobAnalysisVersion } from "./evidence/job-analysis";

const MATCH_RESULT_QUERY_BATCH_SIZE = 400;
const INACTIVE_JOB_STATUSES: Array<"rejected" | "archived"> = [
  "rejected",
  "archived",
];

type MatchableJob = { id: number };

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
  | "source"
  | "isStale"
  | "createdAt"
> & {
  matchPolicyVersion?: string | null;
  matchRunId?: string | null;
};

export interface CurrentMatchContext {
  candidateFingerprint: string;
  scoringPolicyVersion: string;
}

export interface UnmatchedJobFilter {
  discoveredSince?: Date;
}

export interface MatchPresentation {
  matchScore: number | null;
  matchReasons: string[];
  matchedSkills: string[];
  matchResultId: string | null;
  matchBreakdown: MatchBreakdown | null;
  matchStale: boolean;
  matchLegacy: boolean;
  matchSummary: string;
  matchReasoning: MatchReasoningPoint[];
  matchRunId: string | null;
  matchPolicyVersion: string | null;
  scoringPolicyVersion: string | null;
}

interface MatchPresentationOptions {
  includeStale?: boolean;
}

const EMPTY_MATCH_PRESENTATION: MatchPresentation = {
  matchScore: null,
  matchReasons: [],
  matchedSkills: [],
  matchResultId: null,
  matchBreakdown: null,
  matchStale: false,
  matchLegacy: false,
  matchSummary: "",
  matchReasoning: [],
  matchRunId: null,
  matchPolicyVersion: null,
  scoringPolicyVersion: null,
};

async function resolveActiveProviderId(configuredProviderId?: string): Promise<string | null> {
  if (configuredProviderId) {
    const rows = await db.select({ id: aiProviders.id }).from(aiProviders).where(and(
      eq(aiProviders.id, configuredProviderId),
      eq(aiProviders.isActive, true)
    )).limit(1);
    return rows[0]?.id ?? null;
  }
  const rows = await db.select({ id: aiProviders.id, provider: aiProviders.provider })
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))
    .orderBy(desc(aiProviders.isDefault), asc(aiProviders.createdAt))
    .limit(100);
  return rows.find((row) => !isLocalCLIProvider(row.provider))?.id ?? null;
}

export async function getCurrentMatchContext(): Promise<CurrentMatchContext | null> {
  const [config, profileData] = await Promise.all([
    getMatcherConfig(),
    fetchCandidateProfileSnapshot(),
  ]);
  if (!profileData || !config.model || !config.jobAnalysisModel) return null;

  const [providerId, jobAnalysisProviderId] = await Promise.all([
    resolveActiveProviderId(config.providerId),
    resolveActiveProviderId(config.jobAnalysisProviderId),
  ]);
  if (!providerId || !jobAnalysisProviderId) return null;

  const candidateEvidence = enrichCandidateEvidence(buildCandidateEvidence(profileData));

  return {
    candidateFingerprint: buildCandidateFingerprint(candidateEvidence),
    scoringPolicyVersion: buildMatchPolicyVersion(
      { ...config, providerId },
      buildJobAnalysisVersion({ ...config, jobAnalysisProviderId })
    ),
  };
}

function parseMatchRow(row: PresentationMatchRow, summaryOnly = false): MatchPresentation {
  const evidence: MatchEvidence = summaryOnly ? { summary: "", reasoning: [], matchedSkills: [] } : MatchEvidenceSchema.parse(JSON.parse(row.evidenceJson));
  return {
    ...EMPTY_MATCH_PRESENTATION,
    matchScore: row.score,
    matchReasons: evidence.reasoning.map((point) => point.text),
    matchedSkills: evidence.matchedSkills,
    matchResultId: row.id,
    matchBreakdown: summaryOnly || row.source === "legacy" ? null : MatchBreakdownSchema.parse(JSON.parse(row.breakdownJson)),
    matchLegacy: row.source === "legacy",
    matchSummary: evidence.summary,
    matchReasoning: evidence.reasoning,
    matchRunId: row.matchRunId ?? null,
    matchPolicyVersion: row.matchPolicyVersion ?? row.scoringPolicyVersion,
    scoringPolicyVersion: row.scoringPolicyVersion,
  };
}

export function selectMatchPresentation(
  rowsInput: PresentationMatchRow[],
  context: CurrentMatchContext | null,
  summaryOnly = false
): MatchPresentation {
  const rows = [...rowsInput].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id)
  );
  const fresh = context ? rows.find((row) => !row.isStale && row.candidateFingerprint === context.candidateFingerprint) : undefined;
  const selected = fresh ?? rows[0];
  if (!selected) return { ...EMPTY_MATCH_PRESENTATION, scoringPolicyVersion: context?.scoringPolicyVersion ?? null };
  return { ...parseMatchRow(selected, summaryOnly), matchStale: !fresh && selected.source !== "legacy" };
}

export const MATCH_SUMMARY_SELECTION = {
  id: matchResults.id,
  jobId: matchResults.jobId,
  candidateFingerprint: matchResults.candidateFingerprint,
  jobFingerprint: matchResults.jobFingerprint,
  scoringPolicyVersion: matchResults.scoringPolicyVersion,
  score: matchResults.score,
  source: matchResults.source,
  matchPolicyVersion: matchResults.matchPolicyVersion,
  matchRunId: matchResults.matchRunId,
  isStale: matchResults.isStale,
  createdAt: matchResults.createdAt,
};

export function presentMatchSummary(
  row: Pick<PresentationMatchRow, keyof typeof MATCH_SUMMARY_SELECTION> | null,
  context: CurrentMatchContext | null
): MatchPresentation {
  return selectMatchPresentation(row ? [{ ...row, evidenceJson: "", breakdownJson: "" }] : [], context, true);
}

export async function getMatchPresentations(
  jobRows: MatchableJob[],
  contextInput?: CurrentMatchContext | null,
  options: MatchPresentationOptions & { summaryOnly?: boolean } = {}
): Promise<Map<number, MatchPresentation>> {
  if (jobRows.length === 0) return new Map();
  const context = contextInput === undefined ? await getCurrentMatchContext() : contextInput;
  const rowsByJobId = new Map<number, PresentationMatchRow[]>();
  for (let offset = 0; offset < jobRows.length; offset += MATCH_RESULT_QUERY_BATCH_SIZE) {
    const batch = jobRows.slice(offset, offset + MATCH_RESULT_QUERY_BATCH_SIZE);
    const selection = options.summaryOnly ? MATCH_SUMMARY_SELECTION : {
      ...MATCH_SUMMARY_SELECTION,
      evidenceJson: matchResults.evidenceJson,
      breakdownJson: matchResults.breakdownJson,
    };
    const rows = await db.select(selection).from(jobs)
      .innerJoin(matchResults, eq(matchResults.id, buildPreferredMatchResultId(context)))
      .where(inArray(jobs.id, batch.map((job) => job.id)));
    for (const row of rows) {
      const fresh = context && !row.isStale && row.candidateFingerprint === context.candidateFingerprint;
      if (options.includeStale === false && !fresh) continue;
      rowsByJobId.set(row.jobId, [{ ...row,
        evidenceJson: "evidenceJson" in row ? row.evidenceJson as string : "",
        breakdownJson: "breakdownJson" in row ? row.breakdownJson as string : "",
      }]);
    }
  }
  return new Map(jobRows.map((job) => [job.id,
    selectMatchPresentation(rowsByJobId.get(job.id) ?? [], context, options.summaryOnly),
  ]));
}

export async function getFreshUnmatchedJobIds(
  contextInput?: CurrentMatchContext | null,
  filter: UnmatchedJobFilter = {}
): Promise<number[]> {
  const context = contextInput === undefined
    ? await getCurrentMatchContext()
    : contextInput;
  if (!context) {
    return (await db.select({ id: jobs.id }).from(jobs)
      .where(and(
        notInArray(jobs.status, INACTIVE_JOB_STATUSES),
        filter.discoveredSince ? gte(jobs.discoveredAt, filter.discoveredSince) : undefined
      ))).map((job) => job.id);
  }
  const currentResultJoin = and(
    eq(matchResults.jobId, jobs.id),
    eq(matchResults.candidateFingerprint, context.candidateFingerprint),
    eq(matchResults.isStale, false)
  );
  const rows = await db.select({ id: jobs.id }).from(jobs)
    .leftJoin(matchResults, currentResultJoin)
    .where(and(
      isNull(matchResults.id),
      notInArray(jobs.status, INACTIVE_JOB_STATUSES),
      filter.discoveredSince ? gte(jobs.discoveredAt, filter.discoveredSince) : undefined
    ));
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
  const query = db.select({ id: jobs.id }).from(jobs);
  return jobIds
    ? query.where(inArray(jobs.id, jobIds))
    : query;
}

export async function getFreshUnmatchedJobCount(
  contextInput?: CurrentMatchContext | null,
  filter: UnmatchedJobFilter = {}
): Promise<number> {
  const context = contextInput === undefined
    ? await getCurrentMatchContext()
    : contextInput;
  if (!context) {
    const [result] = await db.select({ value: count() }).from(jobs)
      .where(and(
        notInArray(jobs.status, INACTIVE_JOB_STATUSES),
        filter.discoveredSince ? gte(jobs.discoveredAt, filter.discoveredSince) : undefined
      ));
    return result?.value ?? 0;
  }
  const currentResultJoin = and(
    eq(matchResults.jobId, jobs.id),
    eq(matchResults.candidateFingerprint, context.candidateFingerprint),
    eq(matchResults.isStale, false)
  );
  const [result] = await db.select({ value: count() }).from(jobs)
    .leftJoin(matchResults, currentResultJoin)
    .where(and(
      isNull(matchResults.id),
      notInArray(jobs.status, INACTIVE_JOB_STATUSES),
      filter.discoveredSince ? gte(jobs.discoveredAt, filter.discoveredSince) : undefined
    ));
  return result?.value ?? 0;
}

export function getUnmatchedJobIds(filter: UnmatchedJobFilter = {}): Promise<number[]> {
  return getFreshUnmatchedJobIds(undefined, filter);
}

export function getUnmatchedJobCount(filter: UnmatchedJobFilter = {}): Promise<number> {
  return getFreshUnmatchedJobCount(undefined, filter);
}
