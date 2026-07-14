import { z } from "zod";

import type { AICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";
import { fingerprintAIInput } from "@/lib/ai/runtime/fingerprint";

import type { MatcherConfig, MatchQualityPreset } from "../types";
import type { ScoringCandidate } from "./candidate";
import {
  JOB_ANALYSIS_EXTRACTOR_VERSION,
  type MatchingJobAnalysis,
} from "./job-analysis";
import {
  applyAdjudicationAdjustment,
  SCORING_POLICY_VERSION,
  type DeterministicScoreResult,
} from "./scoring";

const AdjudicationSchema = z.object({
  adjustment: z.number().min(-10).max(10),
  evidenceReferences: z.array(z.string().min(1).max(100)).min(1).max(12),
  rationale: z.string().min(1).max(1_000),
}).strict();

export interface AdjudicatedScore {
  score: number;
  adjustment: number;
  runId: string;
  rationale: string;
  evidenceReferences: string[];
  attempts: number;
}

export function shouldAdjudicate(
  preset: MatchQualityPreset,
  deterministic: DeterministicScoreResult
): boolean {
  if (preset === "economy") return deterministic.confidence < 0.4;
  if (preset === "balanced") {
    return deterministic.confidence < 0.75 &&
      deterministic.score >= 50 && deterministic.score <= 75;
  }
  return deterministic.confidence < 0.9 ||
    (deterministic.score >= 40 && deterministic.score <= 85);
}

export function buildScoringPolicyVersion(
  config: Pick<MatcherConfig, "qualityPreset" | "model" | "reasoningEffort"> & {
    providerId?: string;
  },
  extractorVersion = JOB_ANALYSIS_EXTRACTOR_VERSION
): string {
  const policyFingerprint = fingerprintAIInput({
    scoring: SCORING_POLICY_VERSION,
    extractor: extractorVersion,
    preset: config.qualityPreset,
    providerId: config.providerId ?? null,
    modelId: config.model || null,
    reasoningEffort: config.reasoningEffort,
  }).slice(0, 20);
  return `${SCORING_POLICY_VERSION}-${policyFingerprint}`;
}

export async function adjudicateMatch(
  runtime: AICapabilityRuntime,
  candidate: ScoringCandidate,
  job: MatchingJobAnalysis,
  deterministic: DeterministicScoreResult,
  config: MatcherConfig,
  signal?: AbortSignal
): Promise<AdjudicatedScore> {
  const result = await runtime.executeStructured({
    instructions: `You adjudicate ambiguous job matches using only supplied evidence.
Return a bounded adjustment from -10 to +10. Never override a stated hard cap.
Evidence references must name supplied componentEvidence keys.`,
    prompt: JSON.stringify({
      candidate: {
        skills: Array.from(candidate.normalizedSkills),
        totalExperienceYears: candidate.totalExperienceYears,
        seniorityLevel: candidate.seniorityLevel,
        managementExperience: candidate.managementExperience,
        preferredCountry: candidate.evidence.preferences.preferredCountry,
        preferredCity: candidate.evidence.preferences.preferredCity,
        acceptedLocationTypes: candidate.evidence.preferences.acceptedLocationTypes,
        acceptedEmploymentTypes: candidate.evidence.preferences.acceptedEmploymentTypes,
      },
      job: {
        title: job.jobEvidence.title,
        location: job.jobEvidence.location,
        locationType: job.jobEvidence.locationType,
        employmentType: job.jobEvidence.employmentType,
        analysis: job.analysis,
      },
      deterministic: {
        score: deterministic.score,
        hardCap: deterministic.hardCap,
        confidence: deterministic.confidence,
        breakdown: deterministic.breakdown,
        componentEvidence: deterministic.evidence.componentEvidence,
      },
    }),
    schema: AdjudicationSchema,
    policy: {
      maxAttempts: config.maxRetries,
      timeoutMs: config.timeoutMs,
      reasoningEffort: runtime.reasoningEffort,
    },
    subject: { type: "job", id: String(job.job.id) },
    versions: {
      prompt: "match-adjudication-prompt-v1",
      schema: "match-adjudication-schema-v1",
      policy: "match-adjudication-policy-v1",
    },
    inputFingerprint: fingerprintAIInput({
      candidateFingerprint: fingerprintAIInput(candidate.evidence),
      jobFingerprint: job.jobFingerprint,
      scoringPolicyVersion: buildScoringPolicyVersion(config),
      deterministicScore: deterministic.score,
    }),
    signal,
    retry: {
      baseDelayMs: config.backoffBaseDelay,
      maxDelayMs: config.backoffMaxDelay,
    },
    validate: (output) => {
      const availableEvidence = new Set(
        Object.keys(deterministic.evidence.componentEvidence)
      );
      return output.evidenceReferences.every((reference) =>
        availableEvidence.has(reference)
      );
    },
  });

  return {
    score: applyAdjudicationAdjustment(deterministic, result.output.adjustment),
    adjustment: result.output.adjustment,
    runId: result.runId,
    rationale: result.output.rationale,
    evidenceReferences: result.output.evidenceReferences,
    attempts: result.attempts,
  };
}
