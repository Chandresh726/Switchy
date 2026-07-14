import type {
  JobAnalysisEvidence,
  JobEvidenceInput,
  MatchBreakdown,
  MatchEvidence,
} from "@/lib/ai/artifacts";
import { COUNTRY_MAPPINGS } from "@/lib/scraper/utils/common";

import {
  inferSeniority,
  normalizeSkill,
  seniorityRank,
  type ScoringCandidate,
} from "./candidate";

export const SCORING_POLICY_VERSION = "evidence-score-v1";

const COMPONENT_WEIGHTS = {
  mustHaveSkills: 35,
  preferredSkills: 10,
  experience: 20,
  seniority: 10,
  location: 15,
  employmentType: 10,
} as const;

type ComponentName = keyof typeof COMPONENT_WEIGHTS;

export interface DeterministicScoreResult {
  score: number;
  breakdown: MatchBreakdown;
  evidence: MatchEvidence;
  confidence: number;
  hardCap: number | null;
  availableWeight: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function truncateEvidence(value: string): string {
  return value.slice(0, 2_000);
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeSkill).filter(Boolean));
}

function containsLocationTerm(location: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  ).test(location);
}

function containsCountryEquivalent(location: string, country: string): boolean {
  const normalizedCountry = country.toLocaleLowerCase("en-US").trim();
  const canonicalCountry = Object.entries(COUNTRY_MAPPINGS).find(
    ([key, variations]) =>
      key === normalizedCountry || variations.includes(normalizedCountry)
  )?.[0];
  const variations = canonicalCountry
    ? COUNTRY_MAPPINGS[canonicalCountry] ?? [normalizedCountry]
    : [normalizedCountry];
  return variations.some((variation) => containsLocationTerm(location, variation));
}

function inferArrangement(constraints: string[]): string | undefined {
  const text = constraints.join("; ").toLocaleLowerCase("en-US");
  const hasRemote = /\bremote\b/.test(text) &&
    !/(?:\bno\b|\bnot\b|\bwithout\b)\s+(?:\w+\s+){0,3}\bremote\b|\bremote\b.{0,30}\b(?:not available|unavailable|not allowed|not offered|not permitted)\b/.test(text);
  const hasOnsite = /\bon-?site\b/.test(text) &&
    !/(?:\bno\b|\bnot\b|\bwithout\b)\s+(?:\w+\s+){0,3}\bon-?site\b|\bon-?site\b.{0,30}\b(?:not available|unavailable|not allowed|not offered|not permitted)\b/.test(text);
  const hasHybrid = /\bhybrid\b/.test(text) &&
    !/(?:\bno\b|\bnot\b|\bwithout\b)\s+(?:\w+\s+){0,3}\bhybrid\b|\bhybrid\b.{0,30}\b(?:not available|unavailable|not allowed|not offered|not permitted)\b/.test(text);

  if (hasHybrid || (hasRemote && hasOnsite)) return "hybrid";
  if (hasOnsite) return "onsite";
  if (hasRemote) return "remote";
  return undefined;
}

function hasExplicitGeography(value: string): boolean {
  const remainder = value.toLocaleLowerCase("en-US")
    .replace(/\b(remote|hybrid|on-?site|work|working|role|position|job|is|are|available|allowed|option|can|be|performed|anywhere|only|in|from|within|based|located|restricted|limited|fully|friendly|first)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return remainder.length > 0;
}

function skillComponent(
  required: string[],
  candidateSkills: Set<string>
): { score: number; matched: string[]; missing: string[] } | null {
  const normalized = normalizedSet(required);
  if (normalized.size === 0) return null;
  const matched = Array.from(normalized).filter((skill) => candidateSkills.has(skill));
  const missing = Array.from(normalized).filter((skill) => !candidateSkills.has(skill));
  return {
    score: (matched.length / normalized.size) * 100,
    matched,
    missing,
  };
}

function locationComponent(
  candidate: ScoringCandidate,
  job: JobEvidenceInput,
  analysis: JobAnalysisEvidence
): { score: number; conflict: boolean; reason: string } | null {
  const analyzedArrangement = inferArrangement(analysis.locationConstraints);
  const locationType = (analyzedArrangement ?? job.locationType)
    ?.replace("-", "")
    .toLocaleLowerCase("en-US");
  const geographicLocation = [job.location, ...analysis.locationConstraints]
    .filter((item): item is string => Boolean(item && hasExplicitGeography(item)))
    .join(", ")
    .toLocaleLowerCase("en-US");
  const accepted = candidate.evidence.preferences.acceptedLocationTypes;
  const preferredCountry = candidate.evidence.preferences.preferredCountry;
  const preferredCity = candidate.evidence.preferences.preferredCity;

  if (!locationType && !geographicLocation) return null;
  if (locationType === "remote") {
    const arrangementCompatible = accepted.length === 0 || accepted.includes("remote");
    if (!arrangementCompatible) {
      return {
        score: 0,
        conflict: false,
        reason: "Remote work arrangement is outside candidate preferences",
      };
    }
    if ((preferredCity || preferredCountry) && geographicLocation) {
      const geographyCompatible = preferredCity
        ? containsLocationTerm(geographicLocation, preferredCity)
        : Boolean(
            preferredCountry && containsCountryEquivalent(
              geographicLocation,
              preferredCountry
            )
          );
      return {
        score: geographyCompatible ? 100 : 0,
        conflict: false,
        reason: geographyCompatible
          ? "Remote role's geographic restriction matches candidate preference"
          : "Remote role's geographic restriction conflicts with candidate preference",
      };
    }
    return {
      score: 100,
      conflict: false,
      reason: "Role is remote",
    };
  }

  if (accepted.length > 0 && locationType && !accepted.includes(locationType)) {
    return {
      score: 0,
      conflict: locationType === "onsite",
      reason: `Work arrangement ${locationType} is outside candidate preferences`,
    };
  }

  const hasGeographicPreference = Boolean(preferredCountry || preferredCity);
  if (!hasGeographicPreference) {
    if (accepted.length > 0 && locationType) {
      return {
        score: 100,
        conflict: false,
        reason: `Accepted ${locationType} work arrangement`,
      };
    }
    return null;
  }

  if (!geographicLocation) return null;

  const geographyCompatible = preferredCity
    ? containsLocationTerm(geographicLocation, preferredCity)
    : Boolean(
        preferredCountry && containsCountryEquivalent(
          geographicLocation,
          preferredCountry
        )
      );
  return {
    score: geographyCompatible ? 100 : 0,
    conflict: !geographyCompatible && locationType === "onsite",
    reason: geographyCompatible
      ? "Job location matches candidate preference"
      : "Job location conflicts with candidate preference",
  };
}

function employmentComponent(
  candidate: ScoringCandidate,
  job: JobEvidenceInput,
  analysis: JobAnalysisEvidence
): { score: number; reason: string } | null {
  const employmentType = (job.employmentType ?? analysis.employmentType)
    ?.toLocaleLowerCase("en-US");
  const accepted = candidate.evidence.preferences.acceptedEmploymentTypes;
  if (!employmentType || accepted.length === 0) return null;
  const compatible = accepted.includes(employmentType);
  return {
    score: compatible ? 100 : 0,
    reason: compatible
      ? `Accepted ${employmentType} employment type`
      : `Employment type ${employmentType} is outside candidate preferences`,
  };
}

export function scoreDeterministically(
  candidate: ScoringCandidate,
  job: JobEvidenceInput,
  analysis: JobAnalysisEvidence
): DeterministicScoreResult {
  const values: Partial<Record<ComponentName, number>> = {};
  const componentEvidence: Record<string, string[]> = {};
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let hardCap: number | null = null;

  const mustHave = skillComponent(analysis.mustHaveSkills, candidate.normalizedSkills);
  const preferred = skillComponent(analysis.preferredSkills, candidate.normalizedSkills);
  if (mustHave) {
    values.mustHaveSkills = mustHave.score;
    componentEvidence.mustHaveSkills = [
      truncateEvidence(`Matched: ${mustHave.matched.join(", ") || "none"}`),
      truncateEvidence(`Missing: ${mustHave.missing.join(", ") || "none"}`),
    ];
    reasons.push(`${mustHave.matched.length}/${mustHave.matched.length + mustHave.missing.length} must-have skills matched`);
    if (mustHave.missing.length > 0) {
      recommendations.push(truncateEvidence(
        `Address missing must-have skills: ${mustHave.missing.join(", ")}`
      ));
    }
  }
  if (preferred) {
    values.preferredSkills = preferred.score;
    componentEvidence.preferredSkills = [
      truncateEvidence(`Matched: ${preferred.matched.join(", ") || "none"}`),
      truncateEvidence(`Missing: ${preferred.missing.join(", ") || "none"}`),
    ];
  }

  if (analysis.minimumExperienceYears !== null && candidate.totalExperienceYears !== null) {
    const gap = analysis.minimumExperienceYears - candidate.totalExperienceYears;
    values.experience = gap <= 0 ? 100 : Math.max(0, 100 - gap * 25);
    componentEvidence.experience = [
      `Candidate: ${candidate.totalExperienceYears.toFixed(1)} years`,
      `Required: ${analysis.minimumExperienceYears} years`,
    ];
    if (gap >= 3) {
      hardCap = Math.min(hardCap ?? 100, 50);
      reasons.push(`Explicit experience gap of ${round(gap)} years applies a 50-point cap`);
    }
  }

  const requiredSeniority = inferSeniority(analysis.seniorityLevel ?? job.seniorityLevel);
  if (requiredSeniority && candidate.seniorityLevel) {
    const gap = seniorityRank(requiredSeniority) - seniorityRank(candidate.seniorityLevel);
    values.seniority = gap <= 0 ? 100 : gap === 1 ? 60 : 20;
    componentEvidence.seniority = [
      `Candidate: ${candidate.seniorityLevel}`,
      `Required: ${requiredSeniority}`,
    ];
    if (gap >= 2) {
      hardCap = Math.min(hardCap ?? 100, 55);
      reasons.push("Two-level seniority mismatch applies a 55-point cap");
    }
  }
  if (analysis.managementTrack === true && !candidate.managementExperience) {
    values.seniority = Math.min(values.seniority ?? 100, 20);
    componentEvidence.seniority = [
      ...(componentEvidence.seniority ?? []),
      "Role explicitly requires management experience; candidate evidence does not show it",
    ];
    reasons.push("Management-track requirement is not supported by candidate evidence");
  }

  const location = locationComponent(candidate, job, analysis);
  if (location) {
    values.location = location.score;
    componentEvidence.location = [location.reason];
    if (location.conflict) {
      hardCap = Math.min(hardCap ?? 100, 50);
      reasons.push("Explicit onsite location conflict applies a 50-point cap");
    }
  }

  const employment = employmentComponent(candidate, job, analysis);
  if (employment) {
    values.employmentType = employment.score;
    componentEvidence.employmentType = [employment.reason];
  }

  const availableComponents = Object.entries(values) as Array<[ComponentName, number]>;
  const availableWeight = availableComponents.reduce(
    (sum, [component]) => sum + COMPONENT_WEIGHTS[component],
    0
  );
  const weightedScore = availableWeight === 0
    ? 0
    : availableComponents.reduce(
      (sum, [component, componentScore]) =>
        sum + componentScore * COMPONENT_WEIGHTS[component],
      0
    ) / availableWeight;
  const score = round(Math.min(weightedScore, hardCap ?? 100));
  const evidenceAvailability = availableWeight / 100;
  const confidence = Math.round(
    ((analysis.extractionConfidence + evidenceAvailability) / 2) * 1_000
  ) / 1_000;

  return {
    score,
    breakdown: Object.fromEntries(
      (Object.keys(COMPONENT_WEIGHTS) as ComponentName[])
        .map((component) => [component, values[component] === undefined ? null : round(values[component]!)])
    ) as MatchBreakdown,
    evidence: {
      reasons,
      matchedSkills: Array.from(new Set([
        ...(mustHave?.matched ?? []),
        ...(preferred?.matched ?? []),
      ])).slice(0, 500),
      missingSkills: Array.from(new Set([
        ...(mustHave?.missing ?? []),
        ...(preferred?.missing ?? []),
      ])).slice(0, 500),
      recommendations,
      componentEvidence,
    },
    confidence,
    hardCap,
    availableWeight,
  };
}

export function applyAdjudicationAdjustment(
  deterministic: DeterministicScoreResult,
  adjustment: number
): number {
  const boundedAdjustment = Math.max(-10, Math.min(10, adjustment));
  const adjusted = Math.max(0, Math.min(100, deterministic.score + boundedAdjustment));
  return round(Math.min(adjusted, deterministic.hardCap ?? 100));
}
